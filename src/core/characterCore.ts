import type { Vec2 } from "./vmath.ts";
import { closestPointOnLineOrNull, roundToInt, roundToInt32, vadd, vdistance, vdot, vlength, vmix, vmul, vnormalize, vsub } from "./vmath.ts";
import { PHYSICAL_SIZE, SERVER_TICK_SPEED, TUNING } from "./tuning.ts";
import type { TuningParams } from "./tuning.ts";
import type { Collision } from "./collision.ts";
import { clampVel, inRange } from "./collision.ts";
import { CFLAG_NOHOOK } from "./tuning.ts";
import type { PlayerInput } from "./types.ts";
import { emptyInput } from "./types.ts";
import { float32 } from "./float.ts";

export const HOOK_RETRACTED = -1;
export const HOOK_IDLE = 0;
export const HOOK_RETRACT_START = 1;
export const HOOK_RETRACT_END = 3;
export const HOOK_FLYING = 4;
export const HOOK_GRABBED = 5;

export const COREEVENT_GROUND_JUMP = 0x01;
export const COREEVENT_AIR_JUMP = 0x02;
export const COREEVENT_HOOK_LAUNCH = 0x04;
export const COREEVENT_HOOK_ATTACH_PLAYER = 0x08;
export const COREEVENT_HOOK_ATTACH_GROUND = 0x10;
export const COREEVENT_HOOK_HIT_NOHOOK = 0x20;
export const COREEVENT_HOOK_RETRACT = 0x40;

export interface CoreWorld {
  allCores(): Iterable<CharacterCore>;
  coreById(id: number): CharacterCore | undefined;
}

const aimY = new Float64Array(16);
const aimX = new Float64Array(16);
const aimAtan = new Float64Array(16);
const aimValid = new Uint8Array(16);
export function aimAtan2(y: number, x: number): number {
  const slot = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77)) >>> 28;
  if (aimValid[slot] === 1 && Object.is(aimY[slot], y) && Object.is(aimX[slot], x)) return aimAtan[slot];
  const v = Math.atan2(y, x);
  aimY[slot] = y;
  aimX[slot] = x;
  aimAtan[slot] = v;
  aimValid[slot] = 1;
  return v;
}

function saturatedAdd(min: number, max: number, current: number, modifier: number): number {
  if (modifier < 0) {
    if (current < min) return current;
    current += modifier;
    if (current < min) current = min;
    return current;
  }
  if (current > max) return current;
  current += modifier;
  if (current > max) current = max;
  return current;
}

function saturatedAdd32(min: number, max: number, current: number, modifier: number): number {
  if (modifier < 0) {
    if (current < min) return current;
    current = F(current + modifier);
    if (current < min) current = min;
    return current;
  }
  if (current > max) return current;
  current = F(current + modifier);
  if (current > max) current = max;
  return current;
}

const F = Math.fround;
function len32(x: number, y: number): number {
  return F(Math.sqrt(F(F(x * x) + F(y * y))));
}

function velocityRamp(value: number, start: number, range: number, curvature: number): number {
  if (value < start) return 1.0;
  return 1.0 / Math.pow(curvature, (value - start) / range);
}

function velocityRamp32(value: number, start: number, range: number, curvature: number): number {
  if (value < start) return 1.0;
  const f = Math.fround;
  return f(1.0 / f(Math.pow(f(curvature), f(f(value - f(start)) / f(range)))));
}

function toInt32(r: number): number {
  return r >= -2147483648 && r < 2147483648 ? r : -2147483648;
}

const MOVE_SIZE: Vec2 = { x: PHYSICAL_SIZE, y: PHYSICAL_SIZE };
const MOVE_ELASTICITY: Vec2 = { x: 0, y: 0 };

export class CharacterCore {
  readonly id: number;
  private readonly collision: Collision;
  private readonly world: CoreWorld;

  tuning: Readonly<TuningParams> = TUNING;

  pos: Vec2 = { x: 0, y: 0 };
  vel: Vec2 = { x: 0, y: 0 };

  private readonly movePos: Vec2 = { x: 0, y: 0 };
  private readonly moveVel: Vec2 = { x: 0, y: 0 };

  hookPos: Vec2 = { x: 0, y: 0 };
  hookDir: Vec2 = { x: 0, y: 0 };
  hookTeleBase: Vec2 = { x: 0, y: 0 };
  hookTick = 0;
  hookState = HOOK_IDLE;
  hookedPlayer = -1;
  attachedPlayers: Set<number> = new Set();

  activeWeapon = 0;

  newHook = false;

  moveRestrictions = 0;

  jumped = 0;
  jumpedTotal = 0;
  jumps = 2;

  direction = 0;
  angle = 0;
  input: PlayerInput = emptyInput();

  triggeredEvents = 0;

  colliding = 0;
  leftWall = false;

  freezeStart = 0;
  freezeEnd = 0;
  isInFreeze = false;
  collisionDisabled = false;
  hookHitDisabled = false;
  endlessHook = false;

  hammerHitDisabled = false;

  shotgunHitDisabled = false;
  grenadeHitDisabled = false;
  laserHitDisabled = false;

  liveFrozen = false;

  jetpack = false;

  endlessJump = false;
  solo = false;

  constructor(id: number, collision: Collision, world: CoreWorld) {
    this.id = id;
    this.collision = collision;
    this.world = world;
  }

  reset(): void {
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.newHook = false;
    this.moveRestrictions = 0;
    this.hookPos = { x: 0, y: 0 };
    this.hookDir = { x: 0, y: 0 };
    this.hookTeleBase = { x: 0, y: 0 };
    this.hookTick = 0;
    this.hookState = HOOK_IDLE;
    this.setHookedPlayer(-1);
    this.attachedPlayers.clear();
    this.jumped = 0;
    this.jumpedTotal = 0;
    this.jumps = 2;
    this.triggeredEvents = 0;

    this.solo = false;
    this.collisionDisabled = false;
    this.endlessHook = false;
    this.hammerHitDisabled = false;
    this.shotgunHitDisabled = false;
    this.grenadeHitDisabled = false;
    this.laserHitDisabled = false;
    this.liveFrozen = false;
    this.jetpack = false;
    this.endlessJump = false;
    this.hookHitDisabled = false;
    this.freezeStart = 0;
    this.freezeEnd = 0;
    this.isInFreeze = false;

    this.input = emptyInput();
  }

  tick(useInput: boolean, doDeferred = true): void {
    if (float32) return this.tick32(useInput, doDeferred);

    this.moveRestrictions = this.collision.getMoveRestrictions(this.pos);
    this.triggeredEvents = 0;

    const grounded = this.collision.isSolidEither(this.pos.x + PHYSICAL_SIZE / 2, this.pos.x - PHYSICAL_SIZE / 2, this.pos.y + PHYSICAL_SIZE / 2 + 5);

    this.vel.y += this.tuning.gravity;

    const maxSpeed = grounded ? this.tuning.groundControlSpeed : this.tuning.airControlSpeed;
    const accel = grounded ? this.tuning.groundControlAccel : this.tuning.airControlAccel;
    const friction = grounded ? this.tuning.groundFriction : this.tuning.airFriction;

    if (useInput) {
      this.direction = this.input.direction;

      const pi = Math.PI;
      const tmpAngle = aimAtan2(this.input.targetY, this.input.targetX);
      if (tmpAngle < -(pi / 2.0)) {
        this.angle = Math.trunc((tmpAngle + 2.0 * pi) * 256.0);
      } else {
        this.angle = Math.trunc(tmpAngle * 256.0);
      }

      if (this.input.jump) {
        if (!(this.jumped & 1)) {
          if (grounded && (!(this.jumped & 2) || this.jumps !== 0)) {
            this.triggeredEvents |= COREEVENT_GROUND_JUMP;
            this.vel.y = -this.tuning.groundJumpImpulse;
            if (this.jumps > 1) {
              this.jumped |= 1;
            } else {
              this.jumped |= 3;
            }
            this.jumpedTotal = 0;
          } else if (!(this.jumped & 2)) {
            this.triggeredEvents |= COREEVENT_AIR_JUMP;
            this.vel.y = -this.tuning.airJumpImpulse;
            this.jumped |= 3;
            this.jumpedTotal++;
          }
        }
      } else {
        this.jumped &= ~1;
      }

      if (this.input.hook) {
        if (this.hookState === HOOK_IDLE) {

          const targetDirection = vnormalize({ x: this.input.targetX, y: this.input.targetY });
          this.hookState = HOOK_FLYING;
          this.hookPos = vadd(this.pos, vmul(targetDirection, PHYSICAL_SIZE * 1.5));
          this.hookDir = targetDirection;
          this.setHookedPlayer(-1);
          this.hookTick = Math.trunc(SERVER_TICK_SPEED * (1.25 - this.tuning.hookDuration));
          this.triggeredEvents |= COREEVENT_HOOK_LAUNCH;
        }
      } else {
        this.setHookedPlayer(-1);
        this.hookState = HOOK_IDLE;
        this.hookPos.x = this.pos.x;
        this.hookPos.y = this.pos.y;
      }
    }

    if (grounded) {
      this.jumped &= ~2;
      this.jumpedTotal = 0;
    }

    if (this.direction < 0) {
      this.vel.x = saturatedAdd(-maxSpeed, maxSpeed, this.vel.x, -accel);
    }
    if (this.direction > 0) {
      this.vel.x = saturatedAdd(-maxSpeed, maxSpeed, this.vel.x, accel);
    }
    if (this.direction === 0) {
      this.vel.x *= friction;
    }

    if (this.hookState === HOOK_IDLE) {
      this.setHookedPlayer(-1);
      this.hookPos.x = this.pos.x;
      this.hookPos.y = this.pos.y;
    } else if (this.hookState >= HOOK_RETRACT_START && this.hookState < HOOK_RETRACT_END) {
      this.hookState++;
    } else if (this.hookState === HOOK_RETRACT_END) {
      this.triggeredEvents |= COREEVENT_HOOK_RETRACT;
      this.hookState = HOOK_RETRACTED;
    } else if (this.hookState === HOOK_FLYING) {
      const hookBase = this.pos;
      let newPos = vadd(this.hookPos, vmul(this.hookDir, this.tuning.hookFireSpeed));
      if (vdistance(hookBase, newPos) > this.tuning.hookLength) {
        this.hookState = HOOK_RETRACT_START;
        newPos = vadd(hookBase, vmul(vnormalize(vsub(newPos, hookBase)), this.tuning.hookLength));
      }

      let goingToHitGround = false;
      let goingToRetract = false;

      const hit = this.collision.intersectLineHook(this.hookPos, newPos);
      if (hit.collision !== 0) {
        if ((hit.collision & CFLAG_NOHOOK) !== 0) {
          goingToRetract = true;
        } else {
          goingToHitGround = true;
        }
        newPos = hit.outPos;
      }

      if (!this.hookHitDisabled && this.tuning.playerHooking && (this.hookState === HOOK_FLYING || !this.newHook)) {
        let bestDistance = 0;
        for (const other of this.world.allCores()) {
          if (other === this || other.solo || this.solo) continue;

          const closest = closestPointOnLineOrNull(this.hookPos, newPos, other.pos);
          if (closest !== null && vdistance(other.pos, closest) < PHYSICAL_SIZE + 2.0) {
            const d = vdistance(this.hookPos, other.pos);
            if (this.hookedPlayer === -1 || d < bestDistance) {
              this.triggeredEvents |= COREEVENT_HOOK_ATTACH_PLAYER;
              this.hookState = HOOK_GRABBED;
              this.setHookedPlayer(other.id);
              bestDistance = d;
            }
          }
        }
      }

      if (this.hookState === HOOK_FLYING) {
        if (goingToHitGround) {
          this.triggeredEvents |= COREEVENT_HOOK_ATTACH_GROUND;
          this.hookState = HOOK_GRABBED;
        } else if (goingToRetract) {
          this.triggeredEvents |= COREEVENT_HOOK_HIT_NOHOOK;
          this.hookState = HOOK_RETRACT_START;
        }
        this.hookPos = newPos;
      }
    }

    if (this.hookState === HOOK_GRABBED) {
      if (this.hookedPlayer !== -1) {
        const other = this.world.coreById(this.hookedPlayer);
        if (other) {
          this.hookPos.x = other.pos.x;
          this.hookPos.y = other.pos.y;
        } else {
          this.setHookedPlayer(-1);
          this.hookState = HOOK_RETRACTED;
          this.hookPos.x = this.pos.x;
          this.hookPos.y = this.pos.y;
        }
      }

      if (this.hookedPlayer === -1 && vdistance(this.hookPos, this.pos) > 46.0) {
        let hookVel = vmul(vnormalize(vsub(this.hookPos, this.pos)), this.tuning.hookDragAccel);

        if (hookVel.y > 0) hookVel = { x: hookVel.x, y: hookVel.y * 0.3 };

        if ((hookVel.x < 0 && this.direction < 0) || (hookVel.x > 0 && this.direction > 0)) {
          hookVel = { x: hookVel.x * 0.95, y: hookVel.y };
        } else {
          hookVel = { x: hookVel.x * 0.75, y: hookVel.y };
        }

        const newVel = vadd(this.vel, hookVel);
        const newVelLength = vlength(newVel);
        if (newVelLength < this.tuning.hookDragSpeed || newVelLength < vlength(this.vel)) {
          this.vel = newVel;
        }
      }

      this.hookTick++;
      const hookedGone = this.hookedPlayer !== -1 && !this.world.coreById(this.hookedPlayer);
      if (this.hookedPlayer !== -1 && (this.hookTick > SERVER_TICK_SPEED + SERVER_TICK_SPEED / 5 || hookedGone)) {
        this.setHookedPlayer(-1);
        this.hookState = HOOK_RETRACTED;
        this.hookPos.x = this.pos.x;
        this.hookPos.y = this.pos.y;
      }
    }

    if (doDeferred) this.tickDeferred();
  }

  private tick32(useInput: boolean, doDeferred: boolean): void {

    this.moveRestrictions = this.collision.getMoveRestrictions(this.pos);
    this.triggeredEvents = 0;

    const grounded = this.collision.isSolidEither(this.pos.x + PHYSICAL_SIZE / 2, this.pos.x - PHYSICAL_SIZE / 2, this.pos.y + PHYSICAL_SIZE / 2 + 5);

    this.vel.x = F(this.vel.x);
    this.vel.y = F(F(this.vel.y) + F(this.tuning.gravity));

    const maxSpeed = F(grounded ? this.tuning.groundControlSpeed : this.tuning.airControlSpeed);
    const accel = F(grounded ? this.tuning.groundControlAccel : this.tuning.airControlAccel);
    const friction = F(grounded ? this.tuning.groundFriction : this.tuning.airFriction);

    if (useInput) {
      this.direction = this.input.direction;

      const pi = Math.PI;
      const tmpAngle = aimAtan2(this.input.targetY, this.input.targetX);
      if (tmpAngle < -(pi / 2.0)) {
        this.angle = Math.trunc((tmpAngle + 2.0 * pi) * 256.0);
      } else {
        this.angle = Math.trunc(tmpAngle * 256.0);
      }

      if (this.input.jump) {
        if (!(this.jumped & 1)) {
          if (grounded && (!(this.jumped & 2) || this.jumps !== 0)) {
            this.triggeredEvents |= COREEVENT_GROUND_JUMP;
            this.vel.y = -F(this.tuning.groundJumpImpulse);
            if (this.jumps > 1) {
              this.jumped |= 1;
            } else {
              this.jumped |= 3;
            }
            this.jumpedTotal = 0;
          } else if (!(this.jumped & 2)) {
            this.triggeredEvents |= COREEVENT_AIR_JUMP;
            this.vel.y = -F(this.tuning.airJumpImpulse);
            this.jumped |= 3;
            this.jumpedTotal++;
          }
        }
      } else {
        this.jumped &= ~1;
      }

      if (this.input.hook) {
        if (this.hookState === HOOK_IDLE) {

          const tl = len32(this.input.targetX, this.input.targetY);
          const tinv = tl === 0 ? 0 : F(1.0 / tl);
          const targetDirection = { x: F(this.input.targetX * tinv), y: F(this.input.targetY * tinv) };
          this.hookState = HOOK_FLYING;

          this.hookPos = { x: F(F(this.pos.x) + F(F(targetDirection.x * PHYSICAL_SIZE) * 1.5)), y: F(F(this.pos.y) + F(F(targetDirection.y * PHYSICAL_SIZE) * 1.5)) };
          this.hookDir = targetDirection;
          this.setHookedPlayer(-1);
          this.hookTick = Math.trunc(F(SERVER_TICK_SPEED * F(1.25 - F(this.tuning.hookDuration))));
          this.triggeredEvents |= COREEVENT_HOOK_LAUNCH;
        }
      } else {
        this.setHookedPlayer(-1);
        this.hookState = HOOK_IDLE;
        this.hookPos.x = this.pos.x;
        this.hookPos.y = this.pos.y;
      }
    }

    if (grounded) {
      this.jumped &= ~2;
      this.jumpedTotal = 0;
    }

    if (this.direction < 0) {
      this.vel.x = saturatedAdd32(-maxSpeed, maxSpeed, this.vel.x, -accel);
    }
    if (this.direction > 0) {
      this.vel.x = saturatedAdd32(-maxSpeed, maxSpeed, this.vel.x, accel);
    }
    if (this.direction === 0) {
      this.vel.x = F(this.vel.x * friction);
    }

    if (this.hookState === HOOK_IDLE) {
      this.setHookedPlayer(-1);
      this.hookPos.x = this.pos.x;
      this.hookPos.y = this.pos.y;
    } else if (this.hookState >= HOOK_RETRACT_START && this.hookState < HOOK_RETRACT_END) {
      this.hookState++;
    } else if (this.hookState === HOOK_RETRACT_END) {
      this.triggeredEvents |= COREEVENT_HOOK_RETRACT;
      this.hookState = HOOK_RETRACTED;
    } else if (this.hookState === HOOK_FLYING) {
      const hookBase = this.pos;
      const fireSpeed = F(this.tuning.hookFireSpeed);
      const hookLength = F(this.tuning.hookLength);
      let newPos = { x: F(F(this.hookPos.x) + F(F(this.hookDir.x) * fireSpeed)), y: F(F(this.hookPos.y) + F(F(this.hookDir.y) * fireSpeed)) };

      const bx = F(F(newPos.x) - F(hookBase.x));
      const by = F(F(newPos.y) - F(hookBase.y));
      const bl = len32(bx, by);
      if (bl > hookLength) {
        this.hookState = HOOK_RETRACT_START;
        const binv = bl === 0 ? 0 : F(1.0 / bl);
        newPos = { x: F(F(hookBase.x) + F(F(bx * binv) * hookLength)), y: F(F(hookBase.y) + F(F(by * binv) * hookLength)) };
      }

      let goingToHitGround = false;
      let goingToRetract = false;

      const hit = this.collision.intersectLineHook(this.hookPos, newPos);
      if (hit.collision !== 0) {
        if ((hit.collision & CFLAG_NOHOOK) !== 0) {
          goingToRetract = true;
        } else {
          goingToHitGround = true;
        }
        newPos = hit.outPos;
      }

      if (!this.hookHitDisabled && this.tuning.playerHooking && (this.hookState === HOOK_FLYING || !this.newHook)) {
        let bestDistance = 0;
        for (const other of this.world.allCores()) {
          if (other === this || other.solo || this.solo) continue;

          const closest = closestPointOnLineOrNull(this.hookPos, newPos, other.pos);
          if (closest !== null && vdistance(other.pos, closest) < PHYSICAL_SIZE + 2.0) {
            const d = vdistance(this.hookPos, other.pos);
            if (this.hookedPlayer === -1 || d < bestDistance) {
              this.triggeredEvents |= COREEVENT_HOOK_ATTACH_PLAYER;
              this.hookState = HOOK_GRABBED;
              this.setHookedPlayer(other.id);
              bestDistance = d;
            }
          }
        }
      }

      if (this.hookState === HOOK_FLYING) {
        if (goingToHitGround) {
          this.triggeredEvents |= COREEVENT_HOOK_ATTACH_GROUND;
          this.hookState = HOOK_GRABBED;
        } else if (goingToRetract) {
          this.triggeredEvents |= COREEVENT_HOOK_HIT_NOHOOK;
          this.hookState = HOOK_RETRACT_START;
        }
        this.hookPos = newPos;
      }
    }

    if (this.hookState === HOOK_GRABBED) {
      if (this.hookedPlayer !== -1) {
        const other = this.world.coreById(this.hookedPlayer);
        if (other) {
          this.hookPos.x = other.pos.x;
          this.hookPos.y = other.pos.y;
        } else {
          this.setHookedPlayer(-1);
          this.hookState = HOOK_RETRACTED;
          this.hookPos.x = this.pos.x;
          this.hookPos.y = this.pos.y;
        }
      }

      const hx = F(F(this.hookPos.x) - F(this.pos.x));
      const hy = F(F(this.hookPos.y) - F(this.pos.y));
      const hl = len32(hx, hy);
      if (this.hookedPlayer === -1 && hl > 46.0) {
        const hinv = F(1.0 / hl);
        const dragAccel = F(this.tuning.hookDragAccel);
        let hookVelX = F(F(hx * hinv) * dragAccel);
        let hookVelY = F(F(hy * hinv) * dragAccel);

        if (hookVelY > 0) hookVelY = F(hookVelY * F(0.3));

        if ((hookVelX < 0 && this.direction < 0) || (hookVelX > 0 && this.direction > 0)) {
          hookVelX = F(hookVelX * F(0.95));
        } else {
          hookVelX = F(hookVelX * F(0.75));
        }

        const newVel = { x: F(F(this.vel.x) + hookVelX), y: F(F(this.vel.y) + hookVelY) };
        const newVelLength = len32(newVel.x, newVel.y);
        if (newVelLength < F(this.tuning.hookDragSpeed) || newVelLength < len32(F(this.vel.x), F(this.vel.y))) {
          this.vel = newVel;
        }
      }

      this.hookTick++;
      const hookedGone = this.hookedPlayer !== -1 && !this.world.coreById(this.hookedPlayer);
      if (this.hookedPlayer !== -1 && (this.hookTick > SERVER_TICK_SPEED + SERVER_TICK_SPEED / 5 || hookedGone)) {
        this.setHookedPlayer(-1);
        this.hookState = HOOK_RETRACTED;
        this.hookPos.x = this.pos.x;
        this.hookPos.y = this.pos.y;
      }
    }

    if (doDeferred) this.tickDeferred();
  }

  tickDeferred(): void {
    for (const other of this.world.allCores()) {
      if (other === this) continue;
      if (this.solo || other.solo) continue;

      const dist = vdistance(this.pos, other.pos);
      if (dist > 0) {

        const canCollide = !this.collisionDisabled && !other.collisionDisabled && this.tuning.playerCollision;
        if (canCollide && dist < PHYSICAL_SIZE * 1.25) {
          const dir = vnormalize(vsub(this.pos, other.pos));
          const a = PHYSICAL_SIZE * 1.45 - dist;
          let velocity = 0.5;
          if (vlength(this.vel) > 0.0001) {
            velocity = 1 - (vdot(vnormalize(this.vel), dir) + 1) / 2;
          }
          this.vel = vadd(this.vel, vmul(dir, a * (velocity * 0.75)));
          this.vel = vmul(this.vel, 0.85);
        }

        if (!this.hookHitDisabled && this.hookedPlayer === other.id && this.tuning.playerHooking) {
          if (dist > PHYSICAL_SIZE * 1.5) {
            const dir = vnormalize(vsub(this.pos, other.pos));
            const hookAccel = this.tuning.hookDragAccel * (dist / this.tuning.hookLength);
            const dragSpeed = this.tuning.hookDragSpeed;

            other.vel = clampVel(other.moveRestrictions, {
              x: saturatedAdd(-dragSpeed, dragSpeed, other.vel.x, hookAccel * dir.x * 1.5),
              y: saturatedAdd(-dragSpeed, dragSpeed, other.vel.y, hookAccel * dir.y * 1.5),
            });
            this.vel = clampVel(this.moveRestrictions, {
              x: saturatedAdd(-dragSpeed, dragSpeed, this.vel.x, -hookAccel * dir.x * 0.25),
              y: saturatedAdd(-dragSpeed, dragSpeed, this.vel.y, -hookAccel * dir.y * 0.25),
            });
          }
        }
      }
    }

    if (this.hookState !== HOOK_FLYING) {
      this.newHook = false;
    }

    if (vlength(this.vel) > 6000) {
      this.vel = vmul(vnormalize(this.vel), 6000);
    }
  }

  move(): void {
    if (float32) return this.move32();
    const rampValue = velocityRamp(vlength(this.vel) * 50, this.tuning.velrampStart, this.tuning.velrampRange, this.tuning.velrampCurvature);
    this.vel.x = this.vel.x * rampValue;

    const newPos = this.movePos;
    newPos.x = this.pos.x;
    newPos.y = this.pos.y;
    const newVel = this.moveVel;
    newVel.x = this.vel.x;
    newVel.y = this.vel.y;

    const oldVelX = this.vel.x;
    MOVE_ELASTICITY.x = this.tuning.groundElasticityX;
    MOVE_ELASTICITY.y = this.tuning.groundElasticityY;
    this.collision.moveBox(newPos, newVel, MOVE_SIZE, MOVE_ELASTICITY);
    this.vel.x = newVel.x;
    this.vel.y = newVel.y;

    this.colliding = 0;
    if (this.vel.x < 0.001 && this.vel.x > -0.001) {
      if (oldVelX > 0) this.colliding = 1;
      else if (oldVelX < 0) this.colliding = 2;
    } else {
      this.leftWall = true;
    }

    this.vel.x = this.vel.x * (1.0 / rampValue);

    if (this.tuning.playerCollision && !this.collisionDisabled && !this.solo) {

      const dist = vdistance(this.pos, newPos);
      if (dist > 0) {
        const end = Math.trunc(dist + 1);

        const fromX = this.pos.x;
        const fromY = this.pos.y;
        let lastX = fromX;
        let lastY = fromY;

        const cores = this.world.allCores();

        let someoneNear = !(inRange(this.pos.x) && inRange(this.pos.y) && inRange(newPos.x) && inRange(newPos.y));
        if (!someoneNear) {
          const reach = PHYSICAL_SIZE + 8;
          const loX = Math.min(this.pos.x, newPos.x) - reach;
          const hiX = Math.max(this.pos.x, newPos.x) + reach;
          const loY = Math.min(this.pos.y, newPos.y) - reach;
          const hiY = Math.max(this.pos.y, newPos.y) + reach;
          for (const other of cores) {
            if (other === this) continue;
            const p = other.pos;
            if (p.x >= loX && p.x <= hiX && p.y >= loY && p.y <= hiY) {
              someoneNear = true;
              break;
            }
          }
        }
        for (let i = 0; someoneNear && i < end; i++) {
          const a = i / dist;
          const px = fromX + (newPos.x - fromX) * a;
          const py = fromY + (newPos.y - fromY) * a;
          for (const other of cores) {
            if (other === this) continue;
            if (this.solo || other.solo || other.collisionDisabled) continue;
            const dx = px - other.pos.x;
            const dy = py - other.pos.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < PHYSICAL_SIZE) {
              if (a > 0.0) {
                this.pos.x = lastX;
                this.pos.y = lastY;
              } else if (vdistance(newPos, other.pos) > d) {
                this.pos.x = newPos.x;
                this.pos.y = newPos.y;
              }
              return;
            }
          }
          lastX = px;
          lastY = py;
        }
      }
    }

    this.pos.x = newPos.x;
    this.pos.y = newPos.y;
  }

  private move32(): void {
    const f = Math.fround;
    const vx = f(this.vel.x);
    const vy = f(this.vel.y);
    const rampValue = velocityRamp32(f(f(Math.sqrt(f(f(vx * vx) + f(vy * vy)))) * 50), this.tuning.velrampStart, this.tuning.velrampRange, this.tuning.velrampCurvature);
    this.vel.x = f(vx * rampValue);

    const newPos = this.movePos;
    newPos.x = this.pos.x;
    newPos.y = this.pos.y;
    const newVel = this.moveVel;
    newVel.x = this.vel.x;
    newVel.y = this.vel.y;

    const oldVelX = this.vel.x;
    MOVE_ELASTICITY.x = this.tuning.groundElasticityX;
    MOVE_ELASTICITY.y = this.tuning.groundElasticityY;
    this.collision.moveBox(newPos, newVel, MOVE_SIZE, MOVE_ELASTICITY);
    this.vel.x = newVel.x;
    this.vel.y = newVel.y;

    this.colliding = 0;
    if (this.vel.x < 0.001 && this.vel.x > -0.001) {
      if (oldVelX > 0) this.colliding = 1;
      else if (oldVelX < 0) this.colliding = 2;
    } else {
      this.leftWall = true;
    }

    this.vel.x = f(this.vel.x * f(1.0 / rampValue));

    if (this.tuning.playerCollision && !this.collisionDisabled && !this.solo) {

      const dist = vdistance(this.pos, newPos);
      if (dist > 0) {
        const end = Math.trunc(dist + 1);

        const fromX = this.pos.x;
        const fromY = this.pos.y;
        let lastX = fromX;
        let lastY = fromY;

        const cores = this.world.allCores();

        let someoneNear = !(inRange(this.pos.x) && inRange(this.pos.y) && inRange(newPos.x) && inRange(newPos.y));
        if (!someoneNear) {
          const reach = PHYSICAL_SIZE + 8;
          const loX = Math.min(this.pos.x, newPos.x) - reach;
          const hiX = Math.max(this.pos.x, newPos.x) + reach;
          const loY = Math.min(this.pos.y, newPos.y) - reach;
          const hiY = Math.max(this.pos.y, newPos.y) + reach;
          for (const other of cores) {
            if (other === this) continue;
            const p = other.pos;
            if (p.x >= loX && p.x <= hiX && p.y >= loY && p.y <= hiY) {
              someoneNear = true;
              break;
            }
          }
        }
        for (let i = 0; someoneNear && i < end; i++) {
          const a = i / dist;
          const px = fromX + (newPos.x - fromX) * a;
          const py = fromY + (newPos.y - fromY) * a;
          for (const other of cores) {
            if (other === this) continue;
            if (this.solo || other.solo || other.collisionDisabled) continue;
            const dx = px - other.pos.x;
            const dy = py - other.pos.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < PHYSICAL_SIZE) {
              if (a > 0.0) {
                this.pos.x = lastX;
                this.pos.y = lastY;
              } else if (vdistance(newPos, other.pos) > d) {
                this.pos.x = newPos.x;
                this.pos.y = newPos.y;
              }
              return;
            }
          }
          lastX = px;
          lastY = py;
        }
      }
    }

    this.pos.x = newPos.x;
    this.pos.y = newPos.y;
  }

  quantize(): void {
    if (float32) return this.quantize32();
    const x = roundToInt(this.pos.x);
    const y = roundToInt(this.pos.y);
    const velX = toInt32(roundToInt(this.vel.x * 256.0));
    const velY = toInt32(roundToInt(this.vel.y * 256.0));
    const hookX = roundToInt(this.hookPos.x);
    const hookY = roundToInt(this.hookPos.y);
    const hookDx = roundToInt(this.hookDir.x * 256.0);
    const hookDy = roundToInt(this.hookDir.y * 256.0);

    this.pos.x = x;
    this.pos.y = y;
    this.vel.x = velX / 256.0;
    this.vel.y = velY / 256.0;
    this.hookPos.x = hookX;
    this.hookPos.y = hookY;
    this.hookDir.x = hookDx / 256.0;
    this.hookDir.y = hookDy / 256.0;
  }

  private quantize32(): void {
    const x = roundToInt32(this.pos.x);
    const y = roundToInt32(this.pos.y);
    const velX = toInt32(roundToInt32(this.vel.x * 256.0));
    const velY = toInt32(roundToInt32(this.vel.y * 256.0));
    const hookX = roundToInt32(this.hookPos.x);
    const hookY = roundToInt32(this.hookPos.y);
    const hookDx = roundToInt32(this.hookDir.x * 256.0);
    const hookDy = roundToInt32(this.hookDir.y * 256.0);

    this.pos.x = x;
    this.pos.y = y;
    this.vel.x = velX / 256.0;
    this.vel.y = velY / 256.0;
    this.hookPos.x = hookX;
    this.hookPos.y = hookY;
    this.hookDir.x = hookDx / 256.0;
    this.hookDir.y = hookDy / 256.0;
  }

  setHookedPlayer(hookedPlayer: number): void {
    if (hookedPlayer !== this.hookedPlayer) {
      if (this.hookedPlayer !== -1) {
        const prev = this.world.coreById(this.hookedPlayer);
        if (prev) prev.attachedPlayers.delete(this.id);
      }
      if (hookedPlayer !== -1) {
        const next = this.world.coreById(hookedPlayer);
        if (next) next.attachedPlayers.add(this.id);
      }
      this.hookedPlayer = hookedPlayer;
    }
  }
}
