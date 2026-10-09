import { PetBehavior, workMood } from './pet-behavior.js';

export class WidgetCompanionBehavior {
  constructor() {
    this.brain = new PetBehavior();
    this.previous = null;
    this.preferences = { enabled: true, paused: false, motion: true, followWork: true };
  }

  sync(result, preferences, now) {
    const previous = this.previous;
    this.previous = { key: result.key, state: result.state };
    this.preferences = preferences;
    if (!preferences.enabled || preferences.paused) {
      this.brain.interaction = null;
      return;
    }
    if (!previous || previous.key !== result.key || previous.state === result.state ||
        !preferences.followWork || !preferences.motion || this.brain.resting) return;
    if (/休息/.test(result.state)) this.brain.react('stretch', now);
    else if (/下班|已结束/.test(result.state)) this.brain.react('dance', now);
    else if (workMood(previous.state, true) === 'rest' && workMood(result.state, true) === 'idle') {
      this.brain.react('wave', now);
    }
  }

  react(kind, now) {
    if (!this.preferences.enabled || this.preferences.paused) return;
    this.brain.react(kind, now);
  }

  collectCoin(now) {
    if (!this.preferences.motion || this.brain.resting ||
        workMood(this.previous?.state, this.preferences.followWork) === 'rest' ||
        this.brain.interaction?.until > now) return;
    this.react('coin', now);
  }

  toggleRest() {
    if (!this.preferences.enabled || this.preferences.paused) return;
    this.brain.toggleRest();
  }

  get resting() { return this.brain.resting; }

  mood(now) {
    return this.brain.update(now, {
      roam: false,
      motion: this.preferences.motion,
      followWork: this.preferences.followWork,
      workState: this.previous?.state,
    });
  }
}
