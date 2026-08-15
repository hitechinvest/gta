// HUD: здоровье, броня, розыск, деньги, оружие, спидометр, чат,
// килл-фид, таблица игроков и экран смерти.

const el = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.nodes = {
      health: el('hud-health'),
      healthText: el('hud-health-text'),
      armor: el('hud-armor'),
      armorText: el('hud-armor-text'),
      wanted: el('hud-wanted'),
      money: el('hud-money'),
      weapon: el('hud-weapon-name'),
      ammo: el('hud-ammo'),
      speed: el('hud-speed'),
      speedValue: el('hud-speed-value'),
      carName: el('hud-car-name'),
      carHealth: el('hud-car-health'),
      killfeed: el('killfeed'),
      chatLog: el('chat-log'),
      chatInput: el('chat-input'),
      chatForm: el('chat-form'),
      hint: el('hud-hint'),
      scoreboard: el('scoreboard'),
      scoreBody: el('scoreboard-body'),
      death: el('death-screen'),
      deathTimer: el('death-timer'),
      flash: el('damage-flash'),
      stats: el('hud-stats'),
      street: el('hud-street'),
      toast: el('hud-toast'),
    };
    this.chatOpen = false;
    this.onChatSend = null;
    this.lastWanted = -1;

    this.nodes.chatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.nodes.chatInput.value.trim();
      if (text && this.onChatSend) this.onChatSend(text);
      this.nodes.chatInput.value = '';
      this.closeChat();
    });
  }

  openChat() {
    this.chatOpen = true;
    this.nodes.chatForm.classList.add('open');
    this.nodes.chatInput.focus();
  }

  closeChat() {
    this.chatOpen = false;
    this.nodes.chatForm.classList.remove('open');
    this.nodes.chatInput.blur();
  }

  setHealth(hp, armor) {
    const h = Math.max(0, Math.min(100, hp));
    this.nodes.health.style.width = `${h}%`;
    this.nodes.health.classList.toggle('low', h < 30);
    this.nodes.healthText.textContent = Math.round(h);
    const a = Math.max(0, Math.min(100, armor));
    this.nodes.armor.style.width = `${a}%`;
    this.nodes.armorText.textContent = Math.round(a);
  }

  setWanted(level) {
    if (level === this.lastWanted) return;
    this.lastWanted = level;
    const stars = this.nodes.wanted;
    stars.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.className = `star${i < level ? ' on' : ''}`;
      s.textContent = '★';
      stars.appendChild(s);
    }
    stars.classList.toggle('active', level > 0);
    if (level > 0) {
      this.toast(level >= 3 ? 'ДПС стреляет на поражение!' : 'Вас разыскивает полиция');
    }
  }

  setMoney(value) {
    this.nodes.money.textContent = `${Math.round(value).toLocaleString('ru-RU')} ₽`;
  }

  setWeapon(name, mag, reserve) {
    this.nodes.weapon.textContent = name;
    if (mag === Infinity) this.nodes.ammo.textContent = '∞';
    else this.nodes.ammo.textContent = `${mag} / ${reserve}`;
  }

  setVehicle(name, kmh, health) {
    if (!name) {
      this.nodes.speed.classList.remove('show');
      return;
    }
    this.nodes.speed.classList.add('show');
    this.nodes.carName.textContent = name;
    this.nodes.speedValue.textContent = Math.round(kmh);
    this.nodes.carHealth.style.width = `${Math.max(0, Math.min(100, health))}%`;
  }

  setStats(text) {
    this.nodes.stats.textContent = text;
  }

  setStreet(text) {
    this.nodes.street.textContent = text;
  }

  hint(text) {
    if (!text) {
      this.nodes.hint.classList.remove('show');
      return;
    }
    // Текст подсказок формируем сами, поэтому размечаем через innerHTML.
    if (this.nodes.hint.innerHTML !== text) this.nodes.hint.innerHTML = text;
    this.nodes.hint.classList.add('show');
  }

  toast(text, ms = 2600) {
    const node = this.nodes.toast;
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => node.classList.remove('show'), ms);
  }

  killFeed(html) {
    const row = document.createElement('div');
    row.className = 'kill-row';
    row.innerHTML = html;
    this.nodes.killfeed.appendChild(row);
    setTimeout(() => {
      row.classList.add('fade');
      setTimeout(() => row.remove(), 600);
    }, 6000);
    while (this.nodes.killfeed.children.length > 6) {
      this.nodes.killfeed.firstChild.remove();
    }
  }

  chatMessage(name, text, kind = 'player') {
    const row = document.createElement('div');
    row.className = `chat-row ${kind}`;
    if (kind === 'player') {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${name}: `;
      row.appendChild(who);
      row.appendChild(document.createTextNode(text));
    } else {
      row.textContent = text;
    }
    this.nodes.chatLog.appendChild(row);
    this.nodes.chatLog.scrollTop = this.nodes.chatLog.scrollHeight;
    while (this.nodes.chatLog.children.length > 40) this.nodes.chatLog.firstChild.remove();
    row.classList.add('fresh');
    setTimeout(() => row.classList.remove('fresh'), 8000);
  }

  showScoreboard(show) {
    this.scoreVisible = show;
    this.nodes.scoreboard.classList.toggle('show', show);
  }

  updateScoreboard(rows) {
    const body = this.nodes.scoreBody;
    body.innerHTML = '';
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      tr.innerHTML = `
        <td>${escapeHtml(r.name)}</td>
        <td>${r.kills}</td>
        <td>${r.deaths}</td>
        <td>${r.wanted ? '★'.repeat(Math.min(5, r.wanted)) : '—'}</td>
        <td>${r.ping != null ? `${r.ping} мс` : '—'}</td>`;
      body.appendChild(tr);
    }
  }

  damageFlash(strength = 1) {
    const f = this.nodes.flash;
    f.style.opacity = String(Math.min(0.85, 0.3 + strength * 0.5));
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { f.style.opacity = '0'; }, 130);
  }

  showDeath(show, seconds = 5) {
    this.nodes.death.classList.toggle('show', show);
    if (show) this.nodes.deathTimer.textContent = String(seconds);
  }

  setDeathTimer(seconds) {
    this.nodes.deathTimer.textContent = String(Math.max(0, Math.ceil(seconds)));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export { escapeHtml };
