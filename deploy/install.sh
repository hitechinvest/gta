#!/usr/bin/env bash
# Установка «Районов» на сервер: systemd-сервис + vhost nginx с проксированием
# WebSocket + сертификат Let's Encrypt (HTTP-01 через общий webroot).
#
#   bash deploy/install.sh <домен> [порт]
#   bash deploy/install.sh myonlinegame.gdesite.ru 3210
#
# Скрипт идемпотентен: повторный запуск обновляет сервис и конфиг, не ломая
# уже выпущенный сертификат.

set -euo pipefail

FQDN="${1:-myonlinegame.gdesite.ru}"
PORT="${2:-3210}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="rayony"
ACME_ROOT="/var/www/letsencrypt"
VHOST="/etc/nginx/sites-available/${FQDN}.conf"
LE_LIVE="/etc/letsencrypt/live/${FQDN}"
SEED="${SEED:-20250815}"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Запускать под root (sudo -i)"; exit 1; }

# --- 1. Node.js -------------------------------------------------------------
say "Проверяем Node.js"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$MAJOR" -ge 18 ]; then NEED_NODE=0; fi
fi
if [ "$NEED_NODE" -eq 1 ]; then
  say "Ставим Node.js 20 (nodesource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

# --- 2. Зависимости приложения ---------------------------------------------
say "Ставим зависимости в ${APP_DIR}"
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

# Отдельный системный пользователь без логина.
if ! id rayony >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin rayony
fi
chown -R rayony:rayony "$APP_DIR"

# --- 3. systemd -------------------------------------------------------------
say "Настраиваем systemd-сервис ${SERVICE}"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Rayony — сетевая браузерная 3D мини-GTA
After=network.target

[Service]
Type=simple
User=rayony
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=${PORT}
Environment=SEED=${SEED}
ExecStart=$(command -v node) ${APP_DIR}/server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SERVICE}"
systemctl restart "${SERVICE}"
sleep 2
systemctl is-active --quiet "${SERVICE}" || { journalctl -u "${SERVICE}" -n 30 --no-pager; exit 1; }
curl -fsS "http://127.0.0.1:${PORT}/api/status" && echo

# --- 4. nginx: сначала HTTP (нужен для ACME) --------------------------------
say "Пишем vhost ${VHOST}"
mkdir -p "${ACME_ROOT}"

write_vhost_http() {
  cat > "$VHOST" <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name ${FQDN};

    location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; }

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
CONF
}

write_vhost_ssl() {
  # Синтаксис под nginx 1.24 (как в провижининге платформы): http2 задаётся
  # в listen, а не отдельной директивой — «http2 on;» есть только с 1.25.
  # Именно if, а не «test && var=…»: при set -e неудачная проверка в такой
  # связке роняет весь скрипт.
  local extra=""
  if [ -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
    extra="    include /etc/letsencrypt/options-ssl-nginx.conf;"
  fi
  if [ -f /etc/letsencrypt/ssl-dhparams.pem ]; then
    extra="${extra}
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  fi

  cat > "$VHOST" <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name ${FQDN};
    location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${FQDN};

    ssl_certificate     ${LE_LIVE}/fullchain.pem;
    ssl_certificate_key ${LE_LIVE}/privkey.pem;
${extra}

    # Игра отдаёт статику и держит WebSocket на /ws.
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
CONF
}

# Применяем конфиг громко: молчаливый провал nginx -t однажды уже стоил
# нам работающего https — блок 443 просто не появлялся, без единого слова.
apply_nginx() {
  if nginx -t 2>/tmp/nginx-test.log; then
    systemctl reload nginx
    return 0
  fi
  echo
  echo "!!! nginx отверг конфиг ${VHOST}:"
  cat /tmp/nginx-test.log
  if [ "${1:-}" = "fallback" ]; then
    echo "Возвращаем http-версию, чтобы сайт остался доступен."
    write_vhost_http
    nginx -t && systemctl reload nginx
  fi
  return 1
}

# map для корректного Upgrade — один раз на весь nginx.
if [ ! -f /etc/nginx/conf.d/websocket-upgrade.conf ]; then
  cat > /etc/nginx/conf.d/websocket-upgrade.conf <<'MAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
MAP
fi

if [ -f "${LE_LIVE}/fullchain.pem" ]; then
  write_vhost_ssl
else
  write_vhost_http
fi
ln -sf "$VHOST" "/etc/nginx/sites-enabled/${FQDN}.conf"
apply_nginx fallback || true

# --- 5. Сертификат ----------------------------------------------------------
if [ ! -f "${LE_LIVE}/fullchain.pem" ]; then
  say "Выпускаем сертификат для ${FQDN}"
  # У certbot глобальный лок: если платформа в этот момент провижинит сайт,
  # запуск падает. Пробуем несколько раз, ошибку показываем целиком.
  CERT_OK=0
  for attempt in 1 2 3; do
    if certbot certonly --webroot -w "${ACME_ROOT}" -d "${FQDN}" \
        --non-interactive --agree-tos -m "admin@${FQDN#*.}" --keep-until-expiring; then
      CERT_OK=1
      break
    fi
    echo "Попытка ${attempt} не удалась, ждём 20 с…"
    sleep 20
  done

  if [ "$CERT_OK" -eq 1 ]; then
    write_vhost_ssl
    apply_nginx fallback || true
  else
    echo
    echo "!!! Сертификат выпустить не удалось. Сайт работает по http://${FQDN}"
    echo "Последние строки лога certbot:"
    tail -n 25 /var/log/letsencrypt/letsencrypt.log 2>/dev/null || true
    echo
    echo "Разберитесь с причиной и запустите этот же скрипт повторно —"
    echo "он допишет https-конфиг, как только сертификат появится."
  fi
fi

say "Готово"
echo "Адрес:   https://${FQDN}"
echo "Сервис:  systemctl status ${SERVICE}"
echo "Логи:    journalctl -u ${SERVICE} -f"
echo "Статус:  curl -s https://${FQDN}/api/status"
