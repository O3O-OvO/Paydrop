export const moodLabels = {
  idle: '陪伴中', walk: '散步中', rest: '休息中',
  happy: '好开心', eat: '吃点心', drag: '被抱起来了',
  wave: '打个招呼', stretch: '伸个懒腰', dance: '开心摇摆', coin: '抱抱金币',
};

export const reactionDurations = {
  happy: 1700, eat: 3500, wave: 2800, stretch: 2400, dance: 2400, coin: 2100,
};

export function workMood(state, followWork) {
  return followWork && /休息|下班|未开工|未打卡|待打卡|已结束/.test(state || '') ? 'rest' : 'idle';
}

export function stepWithin(position, direction, distance, minimum, maximum) {
  if (maximum <= minimum) return { position: minimum, direction: 1 };
  const next = position + direction * Math.max(0, distance);
  if (next >= maximum) return { position: maximum, direction: -1 };
  if (next <= minimum) return { position: minimum, direction: 1 };
  return { position: next, direction };
}

export class PetBehavior {
  constructor(now = 0) {
    this.resting = false;
    this.interaction = null;
    this.nextWalk = now + 9000;
    this.walkUntil = 0;
  }

  react(kind, now) {
    if (!Object.hasOwn(reactionDurations, kind)) return;
    this.interaction = { kind, until: now + reactionDurations[kind] };
  }

  toggleRest() {
    this.resting = !this.resting;
    this.interaction = null;
  }

  update(now, { dragging = false, hovered = false, roam = true, motion = true, followWork = true, workState = '' } = {}) {
    if (dragging) return 'drag';
    if (this.interaction?.until > now) return this.interaction.kind;
    this.interaction = null;
    if (this.resting || workMood(workState, followWork) === 'rest') return 'rest';
    if (!roam || !motion || hovered) {
      this.walkUntil = 0;
      this.nextWalk = now + 9000;
      return 'idle';
    }
    if (this.walkUntil > now) return 'walk';
    if (now >= this.nextWalk) {
      this.walkUntil = now + 4000;
      this.nextWalk = now + 18000;
      return 'walk';
    }
    return 'idle';
  }
}
