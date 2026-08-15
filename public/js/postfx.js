// Пост-обработка: свечение фонарей, окон и фар ночью + сглаживание.
// Если композер по какой-то причине не собрался, игра рисуется напрямую.
import * as THREE from 'three';
import { EffectComposer } from '/vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '/vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '/vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/vendor/postprocessing/OutputPass.js';
import { FXAAShader } from '/vendor/shaders/FXAAShader.js';

export class PostFX {
  constructor(renderer, scene, camera, quality = 'high') {
    this.enabled = false;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    if (quality === 'low') return;

    try {
      const size = renderer.getSize(new THREE.Vector2());
      this.composer = new EffectComposer(renderer);
      this.composer.setPixelRatio(renderer.getPixelRatio());
      this.composer.setSize(size.x, size.y);
      this.composer.addPass(new RenderPass(scene, camera));

      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        0.35, // сила — днём приглушаем, ночью поднимаем
        0.75, // радиус
        0.92, // порог: светятся только окна, фонари и фары
      );
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());

      if (quality === 'high') {
        this.fxaa = new ShaderPass(FXAAShader);
        this.updateFxaa(size.x, size.y);
        this.composer.addPass(this.fxaa);
      }
      this.enabled = true;
    } catch (err) {
      console.warn('Пост-обработка недоступна, рисуем напрямую:', err);
      this.enabled = false;
    }
  }

  updateFxaa(w, h) {
    if (!this.fxaa) return;
    const pr = this.renderer.getPixelRatio();
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  setSize(w, h) {
    if (!this.enabled) return;
    this.composer.setSize(w, h);
    this.updateFxaa(w, h);
  }

  /** Ночью свечение заметно сильнее — так читаются окна и фары. */
  setNight(dayness) {
    if (!this.bloom) return;
    this.bloom.strength = 0.22 + (1 - Math.min(1, dayness * 1.4)) * 0.62;
    this.bloom.threshold = 0.95 - (1 - Math.min(1, dayness * 1.4)) * 0.2;
  }

  render() {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
