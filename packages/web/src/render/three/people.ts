import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { hash, type Activity } from "@pixel-office/protocol";
import { FX_SIZE, buildFxSheet, type FxStrip } from "../../art/fx.js";
import type { Facing } from "../../office/layout.js";
import type { Look, Person } from "../../world/person.js";
import { SEATS, type SeatShape } from "./office.js";
import { toFloor } from "./space.js";

/** How tall people are (units; a tile is 1). */
const HEIGHT = 1.45;
/** Animation clips in the model, by what we use them for. (Its "sit" clip is a crouch, so sitting is posed in code.) */
type Clip = "idle" | "walk" | "run" | "cheer";
/** Which way to face (radians around y; 0 = towards +z, the camera side). */
const FACING: Record<Facing, number> = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };
/** The model itself faces +x: a quarter turn clockwise (seen from above) makes it face +z. */
const MODEL_YAW = -Math.PI / 2;
/** Before fitting, the hip joint goes this far above the seat; each model is then raised until nothing of it is in the cushion. */
const HIP_ABOVE_SEAT = 0.08;
/** Kneeling: the knee joints sit this high (the knee's own roundness rests on the floor). */
const KNEE_ABOVE_FLOOR = 0.06;
/** Bones the seated pose bends. */
const POSED = ["L_Thigh", "R_Thigh", "L_Calf", "R_Calf", "L_Upperarm", "R_Upperarm", "L_Forearm", "R_Forearm", "Spine01", "Head"] as const;
type PosedBone = (typeof POSED)[number];

/** How one model sits on one kind of seat (see `PersonModel.fit`). */
interface Fit {
  /** Hips this much higher, so the thighs rest on the cushion instead of in it. */
  lift: number;
  /** This much further forward, so the back clears the backrest. */
  forward: number;
  /** Knees this much straighter (radians), so long legs put their feet on the floor instead of through it. */
  knees: number;
}

/** A rigged character model; everyone who looks like this gets a clone of it. */
export class PersonModel {
  readonly scale: number;
  /**
   * How to sit this model on each kind of seat, measured on its own body the
   * first time it sits (people differ: long legs, a big belly, a thick coat):
   * how much higher than the default its hips go, and how far forward.
   */
  readonly fit = new Map<string, Fit>();

  constructor(private gltf: GLTF) {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    this.scale = HEIGHT / (box.max.y - box.min.y);
  }

  instance(): { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<Clip, THREE.AnimationAction> } {
    const root = cloneSkinned(this.gltf.scene);
    root.scale.setScalar(this.scale);
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<Clip, THREE.AnimationAction>();
    for (const clip of this.gltf.animations) {
      const name = clip.name.toLowerCase();
      const kind = (["idle", "walk", "run", "cheer"] as const).find((k) => name === k);
      if (kind && !actions.has(kind)) actions.set(kind, mixer.clipAction(clip));
    }
    return { root, mixer, actions };
  }
}

/**
 * Everyone's looks: a few agent characters (an agent gets one picked from its
 * id) and the named cast (visitors, couriers, medics…), each a Tripo model in
 * public/art/lowpoly/. A cast member without a model of their own borrows an
 * agent look.
 */
export class Cast {
  private constructor(
    private agents: PersonModel[],
    private named: Map<string, PersonModel>,
  ) {}

  static async load(agentFiles: readonly string[], castNames: readonly string[]): Promise<Cast> {
    const loader = new GLTFLoader();
    const url = (name: string) => `${import.meta.env.BASE_URL}art/lowpoly/${name}.glb`;
    const optional = (name: string) => loader.loadAsync(url(name)).then((g) => new PersonModel(g)).catch(() => undefined);
    const [agents, named] = await Promise.all([Promise.all(agentFiles.map(optional)), Promise.all(castNames.map(optional))]);
    const looks = agents.filter((m): m is PersonModel => !!m);
    if (!looks.length) throw new Error("no 3D characters found in art/lowpoly/");
    return new Cast(looks, new Map(castNames.flatMap((n, i) => (named[i] ? [[n, named[i]!] as const] : []))));
  }

  pick(look: Look): PersonModel {
    if ("cast" in look) return this.named.get(look.cast) ?? this.agents[hash(look.cast) % this.agents.length]!;
    return this.agents[hash(look.agent) % this.agents.length]!;
  }
}

/** The activity icons (the same pixel icons as the flat office), as sprites. */
export class Icons {
  private texture: THREE.CanvasTexture;
  private strips: Partial<Record<Activity, FxStrip>>;
  private frames: number;

  constructor() {
    const { canvas, strips } = buildFxSheet();
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.strips = strips;
    this.frames = canvas.width / FX_SIZE;
  }

  /** A sprite showing an activity's icon (its own copy of the icon sheet, to pick frames). */
  sprite(): { sprite: THREE.Sprite; show(activity: Activity, t: number): boolean } {
    const texture = this.texture.clone();
    texture.needsUpdate = true;
    texture.repeat.set(1 / this.frames, 1);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.renderOrder = 10;
    return {
      sprite,
      show: (activity, t) => {
        const strip = this.strips[activity];
        if (!strip || activity === "ended") return false;
        const frame = strip.start + (Math.floor(t * strip.fps) % strip.frames);
        texture.offset.set(frame / this.frames, 0);
        return true;
      },
    };
  }
}

/**
 * One person in the 3D office: the model playing the right animation, turned
 * the way they're walking, plus the coloured ring under the feet, the activity
 * icon by the head, a flame when stuck and a party hat on the birthday.
 */
export class PersonView {
  readonly group = new THREE.Group();
  private root: THREE.Object3D;
  private model: PersonModel;
  private mixer: THREE.AnimationMixer;
  private actions: Map<Clip, THREE.AnimationAction>;
  private current: Clip | undefined;
  private ring: THREE.Mesh;
  private ringColor: number | undefined;
  private icon: ReturnType<Icons["sprite"]>;
  private hat: THREE.Mesh;
  private flame: THREE.Mesh;
  private heading = 0;
  private last: { x: number; z: number } | undefined;
  /** The bones the seated pose bends, with their rest rotations. */
  private bones = new Map<PosedBone, { bone: THREE.Object3D; rest: THREE.Quaternion }>();

  constructor(
    cast: Cast,
    icons: Icons,
    readonly person: Person,
  ) {
    this.model = cast.pick(person.look);
    const inst = this.model.instance();
    this.root = inst.root;
    this.mixer = inst.mixer;
    this.actions = inst.actions;
    this.group.add(this.root);
    this.root.traverse((o) => (o.userData.personId = person.id));
    for (const name of POSED) {
      const bone = this.root.getObjectByName(name);
      if (bone) this.bones.set(name, { bone, rest: bone.quaternion.clone() });
    }

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.group.add(this.ring);

    this.icon = icons.sprite();
    this.icon.sprite.scale.setScalar(0.5);
    this.group.add(this.icon.sprite);

    this.hat = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xc77dff, flatShading: true }));
    this.hat.position.y = HEIGHT + 0.12;
    this.group.add(this.hat);

    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 5), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
    this.flame.position.y = HEIGHT + 0.35;
    this.group.add(this.flame);
    this.heading = FACING[person.facing];
  }

  update(dtMs: number, now: number): void {
    const p = this.person;
    const { x, z } = toFloor(p.x, p.y);
    this.group.position.set(x, 0, z);

    // Turn towards where they're walking; otherwise the way the spot faces.
    let target = FACING[p.facing];
    if (p.pose === "walk" && this.last) {
      const dx = x - this.last.x;
      const dz = z - this.last.z;
      if (Math.hypot(dx, dz) > 1e-4) target = Math.atan2(dx, dz);
    }
    this.last = { x, z };
    this.heading = turn(this.heading, target, Math.min(1, dtMs / 90));

    const seated = p.arrived && !p.lying && (p.pose === "type" || p.pose === "think" || p.pose === "lounge");
    let clip: Clip = "idle";
    if (p.cheering(now)) clip = "cheer";
    else if (p.pose === "walk") clip = p.destination?.run ? "run" : "walk";
    this.play(clip);

    this.root.position.set(0, p.pose === "stomp" ? (Math.floor(now / 160) % 2 ? 0.12 : 0) : 0, 0);
    if (p.lying) {
      this.root.rotation.set(-Math.PI / 2, this.heading + MODEL_YAW, 0, "YXZ");
      this.root.position.y = 0.55;
    } else {
      this.root.rotation.set(0, this.heading + MODEL_YAW, 0);
    }
    // Bones the animation doesn't move would keep last frame's bend: start from rest.
    for (const { bone, rest } of this.bones.values()) bone.quaternion.copy(rest);
    this.mixer.update(dtMs / 1000);
    if (seated && !p.cheering(now)) this.sit(p.pose === "lounge" ? "lounge" : p.pose === "think" ? "think" : "type", now);
    const kneeling = p.arrived && !p.lying && p.pose === "kneel";
    if (kneeling) this.kneel(now);

    this.updateRing();
    const head = kneeling ? HEIGHT * 0.65 : seated ? HEIGHT * 0.8 : HEIGHT;
    const t = (now - p.activitySince) / 1000;
    const showIcon = this.icon.show(p.activity, t);
    this.icon.sprite.visible = showIcon && !p.lying;
    const pop = t < 0.18 ? 0.6 + (t / 0.18) * 0.6 : t < 0.3 ? 1.2 - ((t - 0.18) / 0.12) * 0.2 : 1;
    this.icon.sprite.scale.setScalar(0.45 * pop);
    this.icon.sprite.position.set(p.fxLeft ? -0.45 : 0.45, head - 0.15 + Math.sin(t * 3) * 0.03, 0);

    this.hat.visible = p.hat && !p.lying;
    this.hat.position.y = head + 0.12;
    this.flame.visible = p.stuck && !p.lying;
    if (this.flame.visible) {
      this.flame.position.y = head + 0.4;
      this.flame.scale.set(1, 0.8 + 0.3 * Math.abs(Math.sin(now / 90)), 1);
    }
  }

  destroy(): void {
    this.mixer.stopAllAction();
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        // Skinned clones share geometry with the source model: only free what's ours.
        if (!(o instanceof THREE.SkinnedMesh)) o.geometry.dispose();
        const m = o.material as THREE.Material;
        if (o instanceof THREE.Sprite) (m as THREE.SpriteMaterial).map?.dispose();
        if (!(o instanceof THREE.SkinnedMesh)) m.dispose();
      }
    });
  }

  /**
   * Sit on the seat under us: thighs forward, knees bent, hips lowered onto
   * the seat; at a desk the hands go to the keyboard (or one to the chin while
   * thinking); on a sofa, leaning back.
   */
  private sit(how: "type" | "think" | "lounge", now: number): void {
    this.root.updateMatrixWorld(true);
    // The model's left-right axis in the world (it faces its own +x).
    const across = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const deg = Math.PI / 180;
    const lounge = how === "lounge";
    // The legs start from the model's neutral pose (the idle animation stands with one foot back).
    for (const name of ["L_Thigh", "R_Thigh", "L_Calf", "R_Calf"] as const) {
      const b = this.bones.get(name);
      if (b) b.bone.quaternion.copy(b.rest);
    }
    this.root.updateMatrixWorld(true);
    const fitted = this.model.fit.get(how);
    for (const side of ["L", "R"] as const) {
      this.bend(`${side}_Thigh`, across, (lounge ? 80 : 90) * deg);
      // Shins angled a touch forward, so they clear the front edge of the seat.
      this.bend(`${side}_Calf`, across, -(lounge ? 62 : 80) * deg + (fitted?.knees ?? 0));
    }
    if (lounge) {
      this.bend("Spine01", across, -12 * deg);
      // Hands resting on the thighs.
      for (const side of ["L", "R"] as const) {
        this.bend(`${side}_Upperarm`, across, 35 * deg);
        this.bend(`${side}_Forearm`, across, 30 * deg);
      }
    } else if (how === "type") {
      const tap = Math.sin(now / 90) * 4 * deg;
      this.bend("L_Upperarm", across, 35 * deg);
      this.bend("R_Upperarm", across, 35 * deg);
      this.bend("L_Forearm", across, 55 * deg + tap);
      this.bend("R_Forearm", across, 55 * deg - tap);
    } else {
      // Thinking: chin on one hand, the other arm resting.
      this.bend("R_Upperarm", across, 45 * deg);
      this.bend("R_Forearm", across, 120 * deg);
      this.bend("L_Upperarm", across, 25 * deg);
      this.bend("L_Forearm", across, 40 * deg);
      this.bend("Head", across, 8 * deg);
    }
    // Put the hips on the seat: centred, at its height, then by this model's fit.
    const seat: SeatShape = lounge ? SEATS.sofa : SEATS.chair;
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.root.updateMatrixWorld(true);
    const hip = this.root.getObjectByName("Hip");
    if (!hip) return;
    const at = hip.getWorldPosition(new THREE.Vector3()).sub(this.group.position);
    this.root.position.add(new THREE.Vector3(0, seat.top + HIP_ABOVE_SEAT, 0).addScaledVector(forward, seat.tucked).sub(at));
    let fit = fitted;
    if (!fit) {
      // Measure only once they've finished turning to face out of the seat.
      if (Math.abs(turn(this.heading, FACING[this.person.facing], 1) - this.heading) > 0.01) return;
      fit = this.measureFit(seat, forward);
      this.model.fit.set(how, fit);
    }
    this.root.position.y += fit.lift;
    this.root.position.addScaledVector(forward, fit.forward);
  }

  /**
   * How this body must be placed to sit properly, measured on its skinned
   * vertices in the seated pose: forward until the shins hang in front of the
   * cushion (short legs) and the back clears the backrest, up until the thighs
   * rest on the cushion, and knees straightened until the shoes are on the
   * floor (long legs). Loose clothing (a hem hanging from the waist) doesn't
   * count for the cushion: it just tucks in, like a coat you sit on.
   */
  private measureFit(seat: SeatShape, forward: THREE.Vector3): Fit {
    this.root.updateMatrixWorld(true);
    const across = new THREE.Vector3(-forward.z, 0, forward.x);
    const points: { f: number; s: number; y: number; part: "thigh" | "shin" | "foot" | "body" }[] = [];
    const v = new THREE.Vector3();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      const pos = o.geometry.attributes.position!;
      const joints = o.geometry.attributes.skinIndex!;
      const weights = o.geometry.attributes.skinWeight!;
      for (let i = 0; i < pos.count; i++) {
        // The bone that moves this vertex most says which part of the body it is.
        let best = 0;
        for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
        const bone = o.skeleton.bones[joints.getComponent(i, best)]?.name ?? "";
        const part = /Foot|Toe/.test(bone) ? "foot" : /Calf/.test(bone) ? "shin" : /Thigh/.test(bone) ? "thigh" : "body";
        v.fromBufferAttribute(pos, i);
        o.applyBoneTransform(i, v);
        v.applyMatrix4(o.matrixWorld).sub(this.group.position);
        // Measured from the middle of the seat.
        points.push({ f: v.dot(forward) - seat.tucked, s: v.dot(across), y: v.y, part });
      }
    });
    const margin = 0.01;
    const inWidth = (p: { s: number }) => Math.abs(p.s) < seat.width / 2;
    // Forward: lower legs out in front of the cushion, and the back off the backrest.
    let push = 0;
    for (const p of points) {
      if ((p.part === "shin" || p.part === "foot") && inWidth(p) && p.y < seat.top + margin) push = Math.max(push, seat.ahead + margin - p.f);
      if (inWidth(p) && p.y < seat.backTop && p.f < -seat.behind + margin) push = Math.max(push, -seat.behind + margin - p.f);
    }
    // Up: the thighs rest on the cushion (wherever they are over it after moving forward).
    let lift = 0;
    for (const p of points) {
      const f = p.f + push;
      if (p.part === "thigh" && inWidth(p) && f > -seat.behind && f < seat.ahead && p.y < seat.top + margin) lift = Math.max(lift, seat.top + margin - p.y);
    }
    // Shoes below the floor: straighten the knees. A shin hanging down rises by
    // about length × (1 − cos angle), so the angle is acos(1 − depth / length).
    const lowest = Math.min(...points.filter((p) => p.part === "foot").map((p) => p.y + lift));
    const calf = this.bones.get("L_Calf")?.bone;
    const foot = this.root.getObjectByName("L_Foot");
    const shin = calf && foot ? calf.getWorldPosition(new THREE.Vector3()).distanceTo(foot.getWorldPosition(new THREE.Vector3())) : 0.25;
    const depth = Math.max(0, margin - lowest);
    const knees = depth > 0 ? Math.min(Math.PI / 4, Math.acos(Math.max(-1, 1 - depth / shin)) * 1.2) : 0;
    return { lift, forward: push, knees };
  }

  /** Rotate a bone by `angle` around a world axis, on top of its animated pose. */
  /**
   * Kneel before the statue: thighs upright, shins flat on the floor behind,
   * knees put on the floor (measured on this model's own skeleton), and a slow
   * bow in time with everyone else kneeling (the office's clock, not ours).
   */
  private kneel(now: number): void {
    this.root.updateMatrixWorld(true);
    const across = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const deg = Math.PI / 180;
    for (const name of ["L_Thigh", "R_Thigh", "L_Calf", "R_Calf"] as const) {
      const b = this.bones.get(name);
      if (b) b.bone.quaternion.copy(b.rest);
    }
    this.root.updateMatrixWorld(true);
    for (const side of ["L", "R"] as const) {
      this.bend(`${side}_Thigh`, across, 5 * deg);
      this.bend(`${side}_Calf`, across, -90 * deg);
    }
    // 0 upright with the hands together, 1 bowed low with the arms stretched out ahead.
    // (A turn that swings a hanging bone forward tips an upright one back: the spine and head bend the other way.)
    const bow = 0.5 - 0.5 * Math.cos((2 * Math.PI * now) / 2800);
    this.bend("Spine01", across, -(8 + 50 * bow) * deg);
    this.bend("Head", across, -12 * bow * deg);
    for (const side of ["L", "R"] as const) {
      this.bend(`${side}_Upperarm`, across, (55 + 45 * bow) * deg);
      this.bend(`${side}_Forearm`, across, 70 * (1 - bow) * deg);
    }
    // Down onto the knees: the knee joints (where the shins hang from) just above the floor.
    this.root.updateMatrixWorld(true);
    const knees = ["L_Calf", "R_Calf"].map((n) => this.bones.get(n as PosedBone)?.bone.getWorldPosition(new THREE.Vector3()).y ?? Infinity);
    const lowest = Math.min(...knees);
    if (Number.isFinite(lowest)) this.root.position.y -= lowest - KNEE_ABOVE_FLOOR;
  }

  private bend(name: PosedBone, axis: THREE.Vector3, angle: number): void {
    const b = this.bones.get(name)?.bone;
    if (!b?.parent) return;
    const parent = b.parent.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    b.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));
    b.updateMatrixWorld(true);
  }

  private play(clip: Clip): void {
    if (clip === this.current) return;
    const next = this.actions.get(clip) ?? this.actions.get("idle");
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    if (prev && prev !== next) prev.fadeOut(0.25);
    this.current = clip;
  }

  private updateRing(): void {
    const color = this.person.sessionColor;
    if (color === this.ringColor) return;
    this.ringColor = color;
    this.ring.visible = color !== undefined;
    if (color !== undefined) (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
  }
}

/** Turn from `a` towards `b` (radians) by fraction `k`, the short way round. */
function turn(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
