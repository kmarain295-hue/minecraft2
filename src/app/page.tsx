'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Ban,
  Check,
  Clover,
  Coins,
  Eye,
  EyeOff,
  Gem,
  Images,
  LoaderCircle,
  Package,
  PawPrint,
  Play,
  Rocket,
  Store,
  Sword,
  Target,
  UserRound,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import * as THREE from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MD2Character } from 'three/examples/jsm/misc/MD2Character.js';

/** Mesh augmented by MD2Character at runtime with the active animation action. */
interface ActionMesh extends THREE.Mesh {
  activeAction?: THREE.AnimationAction;
}

/** GitHub brand mark (octicon "mark-github" path) for the export button. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Rotating status lines shown while the GitHub export request is in flight. */
const GH_STEPS = [
  'Authenticating…',
  'Creating repository…',
  'Uploading source files…',
  'Creating commit…',
  'Working — large uploads can take a minute…',
];

/** Debug handle exposed on window for tooling/verification (renders nothing). */
interface PlayerDebugInfo {
  loaded: boolean;
  animation: string;
  moving: boolean;
  airborne: boolean;
  x: number;
  y: number;
  z: number;
  charMinY: number;
  charMaxY: number;
  timeOfDay: number;
  phase: GamePhase;
}

/** Loadout mirror pushed to React so the LOBBY pickers can highlight the
 *  currently equipped skin/weapon. The in-game view itself is UI-free. */
interface LoadoutState {
  skinIndex: number;
  weaponIndex: number;
}

/** Commands the React dashboard can send into the game loop. */
interface GameApi {
  setSkin(index: number): void;
  setWeapon(index: number): void;
  applyDamage(amount: number): void;
  respawn(): void;
}

/** Terrain was generated with 100-unit blocks. */
const BLOCK = 100;
const WORLD_WIDTH = 128;
const WORLD_DEPTH = 128;
const WORLD_HALF_WIDTH = WORLD_WIDTH / 2;
const WORLD_HALF_DEPTH = WORLD_DEPTH / 2;

/** Character tuning (world units / seconds). */
const CHAR_HEIGHT = 190; // ~1.9 blocks tall
const WALK_SPEED = 360;
const BACK_SPEED = 220;
const TURN_SPEED = 2.4; // rad/s
const JUMP_SPEED = 620;
const GRAVITY = 1800;
const RUN_SOUND_VOLUME = 0.35;

/** Health / stamina tuning. */
const MAX_HEALTH = 100;
const MAX_STAMINA = 100;
const FALL_DAMAGE_MIN_SPEED = 800; // landing speed (units/s) where damage starts
const FALL_DAMAGE_SCALE = 0.06;
const STAMINA_DRAIN_RATE = 10; // per second while running
const STAMINA_REGEN_RATE = 18; // per second while not running
const STAMINA_JUMP_COST = 15;
const EXHAUSTED_SPEED_SCALE = 0.55;
const EXHAUSTED_RECOVER_AT = 30;
const HEALTH_REGEN_DELAY = 5; // seconds after damage before regen kicks in
const HEALTH_REGEN_RATE = 5; // per second
const RESPAWN_DELAY = 2.4; // seconds between death and respawn

/** Third-person camera tuning. */
const CAM_DIST = 320;
const CAM_HEIGHT = 170; // default elevation, expressed as pitch via CAM_DEFAULT_PITCH
const CAM_MIN_DIST = 140;
const CAM_MAX_DIST = 900;
const CAM_DEFAULT_PITCH = Math.atan2(CAM_HEIGHT, CAM_DIST);
const CAM_MIN_PITCH = -0.85; // camera drops low, letting you look up at the sky
const CAM_MAX_PITCH = 1.25; // near top-down
const LOOK_HEIGHT = 100;
const CAM_MIN_CLEARANCE = 70;

/** Day/night cycle tuning. */
const CYCLE_SECONDS = 160; // real seconds for a full 24h cycle (~80s day / 80s night)
const DAY_START_HOUR = 9; // hour the game boots at (mid-morning)
const SUNRISE_HOUR = 6; // hour 6 = sun on the east horizon
const SKY_DAY = new THREE.Color(0xbfd1e5);
const SKY_NIGHT = new THREE.Color(0x070b18);
const SKY_SUNSET = new THREE.Color(0xf2984f);
const SUNLIGHT_HIGH = new THREE.Color(0xfff3e2);
const SUNLIGHT_LOW = new THREE.Color(0xff9a55);
const MOONLIGHT = new THREE.Color(0xa7b8e0);
const AMBIENT_DAY = new THREE.Color(0xeeeeee);
const AMBIENT_NIGHT = new THREE.Color(0x46527a);
const AMBIENT_DAY_I = 3;
const AMBIENT_NIGHT_I = 1.1;
const SUN_LIGHT_MAX = 12;
const MOON_LIGHT_MAX = 2.4;
const SUN_TINT_NOON = new THREE.Color(0xffffff);
const SUN_TINT_SET = new THREE.Color(0xff8038);
const STAR_COUNT = 1300;
const STAR_BRIGHT_COUNT = 90;
const STAR_RADIUS = 8800; // inside camera.far, beyond the world edge

/** One-shot animation bindings: key code -> clip name. */
const ACTION_KEYS: Record<string, string> = {
  KeyF: 'attack',
  Digit1: 'wave',
  Digit2: 'taunt',
  Digit3: 'salute',
  Digit4: 'point',
  Digit5: 'flip',
};

/** Body skins (order matches loadParts config) with swatch colors for the UI. */
const SKINS: Array<{ name: string; color: string }> = [
  { name: 'Ratamahatta', color: '#b45309' },
  { name: 'Blue CTF', color: '#60a5fa' },
  { name: 'Red CTF', color: '#f87171' },
  { name: 'Dead', color: '#a1a1aa' },
  { name: 'Gearwhore', color: '#a3b18a' },
];

/** Weapon loadouts backed by real MD2 weapon meshes; null model = unarmed.
 *  The last entry must stay unarmed (applyWeapon maps it to "hide all"). */
const WEAPONS: Array<{
  name: string;
  model: string | null;
  icon: LucideIcon;
}> = [
  { name: 'Blade', model: 'weapon.md2', icon: Sword },
  { name: 'Shotgun', model: 'w_shotgun.md2', icon: Target },
  { name: 'Chaingun', model: 'w_chaingun.md2', icon: Zap },
  { name: 'Railgun', model: 'w_railgun.md2', icon: Rocket },
  { name: 'Unarmed', model: null, icon: Ban },
];

/** Player identity shown on the lobby dashboard. */
const PLAYER_NAME = 'RATLORD_99';
const PLAYER_COINS = 160;
const PLAYER_GEMS = 0;

type GamePhase = 'lobby' | 'playing';

/** Lobby showcase camera + turntable tuning. */
const LOBBY_DIST = 430;
const LOBBY_PITCH = 0.1;
const LOBBY_TURN_SPEED = 0.45; // rad/s auto-rotation
const LOBBY_BLEND_TIME = 1.3; // s, camera sweep from lobby into gameplay

/** Lobby side menu: CHARACTER and WEAPONS open the live loadout pickers. */
const LOBBY_MENU: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'store', label: 'Store', icon: Store },
  { id: 'luck', label: 'Luck Royale', icon: Clover },
  { id: 'character', label: 'Character', icon: UserRound },
  { id: 'vault', label: 'Vault', icon: Package },
  { id: 'pet', label: 'Pet', icon: PawPrint },
  { id: 'collection', label: 'Collection', icon: Images },
  { id: 'weapons', label: 'Weapons', icon: Sword },
];

const LOADOUT_DEFAULT: LoadoutState = { skinIndex: 0, weaponIndex: 0 };

/**
 * The three.js minecraft terrain demo (webgl_geometry_minecraft) combined with
 * the ratamahatta MD2 character (webgl_loader_md2), driven by keyboard controls:
 *
 *   W / S or Up / Down ... walk forward / backward  -> run animation
 *   A / D or Left / Right ............ turn         -> idle animation when still
 *   Space ............................ jump         (costs stamina)
 *   F ................................ attack
 *   1 / 2 / 3 / 4 / 5 ................ wave / taunt / salute / point / flip
 *   Q / E ............................ previous / next skin
 *   X ................................ cycle weapon loadout
 *   Esc .............................. back to the lobby
 *
 *   Mouse drag ....................... orbit the camera around the character
 *   Mouse wheel ...................... zoom in / out
 *
 *   Running drains stamina (exhausted = slow), falls hurt, health regens
 *   after a grace period, and death respawns you at the map origin — all
 *   simulated invisibly: the in-game view is pure 3D with zero HUD, panels
 *   or overlays of any kind.
 *
 *   A real-time day/night cycle plays in the background (a full 24h cycle
 *   every CYCLE_SECONDS real seconds): the sun arcs overhead and sets in
 *   orange, then a cratered moon rises among a field of stars while cool
 *   moonlight takes over the shadows until dawn breaks again.
 *
 * Flow: the page boots into a Free-Fire-style LOBBY dashboard (character
 * showcase + menu chrome). Dragging spins the character, the CHARACTER /
 * WEAPONS menu entries open live loadout pickers, and START sweeps the
 * camera around the character into third-person gameplay. Esc returns to
 * the lobby. Enter also works as START.
 */
export default function MinecraftGamePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GameApi | null>(null);
  const hudBridgeRef = useRef<{
    publish?: (state: LoadoutState) => void;
    enterLobby?: () => void;
  }>({});
  const [loadout, setLoadout] = useState<LoadoutState>(LOADOUT_DEFAULT);
  const [phase, setPhase] = useState<GamePhase>('lobby');
  /** Mirrors phase into the render loop (the loop reads refs, not state). */
  const phaseRef = useRef<GamePhase>('lobby');
  const [lobbyPanel, setLobbyPanel] = useState<'character' | 'weapons' | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // GitHub export panel ("push the whole game source to a GitHub repo")
  const [ghOpen, setGhOpen] = useState(false);
  const [ghToken, setGhToken] = useState('');
  const [ghRepo, setGhRepo] = useState('');
  const [ghShowToken, setGhShowToken] = useState(false);
  const [ghStatus, setGhStatus] = useState<
    'idle' | 'working' | 'success' | 'error'
  >('idle');
  const [ghStep, setGhStep] = useState('');
  const [ghError, setGhError] = useState('');
  const [ghUrl, setGhUrl] = useState('');
  const [ghFiles, setGhFiles] = useState(0);

  /** START: leave the lobby and sweep the camera into third-person gameplay. */
  const enterGame = useCallback(() => {
    phaseRef.current = 'playing';
    setPhase('playing');
    setLobbyPanel(null);
    setGhOpen(false);
  }, []);

  /** Back to the lobby showcase (Esc key). */
  const enterLobby = useCallback(() => {
    phaseRef.current = 'lobby';
    setPhase('lobby');
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  /** Left menu: CHARACTER/WEAPONS toggle pickers, the rest show a toast. */
  const handleMenuClick = useCallback(
    (id: string) => {
      if (id === 'character' || id === 'weapons') {
        setLobbyPanel((current) => (current === id ? null : id));
      } else {
        setLobbyPanel(null);
        showToast('Coming soon');
      }
    },
    [showToast]
  );

  /** Push the entire game source to the caller's GitHub account. */
  const saveToGithub = useCallback(async () => {
    const tokenValue = ghToken.trim();
    const repoValue = ghRepo.trim();
    if (!tokenValue || !repoValue || ghStatus === 'working') return;
    setGhStatus('working');
    setGhError('');
    setGhUrl('');
    setGhStep(GH_STEPS[0]);
    let stepIndex = 0;
    const stepTimer = window.setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, GH_STEPS.length - 1);
      setGhStep(GH_STEPS[stepIndex]);
    }, 4000);
    try {
      const res = await fetch('/api/github/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenValue, repo: repoValue }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        url?: string;
        files?: number;
      };
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error || `GitHub request failed (${res.status}).`);
      }
      setGhUrl(data.url);
      setGhFiles(data.files ?? 0);
      setGhStatus('success');
    } catch (error) {
      setGhError(
        error instanceof Error ? error.message : 'Unexpected network error.'
      );
      setGhStatus('error');
    } finally {
      window.clearInterval(stepTimer);
    }
  }, [ghToken, ghRepo, ghStatus]);

  // Esc closes the GitHub export panel
  useEffect(() => {
    if (!ghOpen) return;
    function onPanelKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setGhOpen(false);
    }
    window.addEventListener('keydown', onPanelKeyDown);
    return () => window.removeEventListener('keydown', onPanelKeyDown);
  }, [ghOpen]);

  // wire the bridge the game loop communicates through
  useEffect(() => {
    hudBridgeRef.current.publish = setLoadout;
    hudBridgeRef.current.enterLobby = enterLobby;
    return () => {
      hudBridgeRef.current.publish = undefined;
      hudBridgeRef.current.enterLobby = undefined;
    };
  }, [enterLobby]);

  // Enter also deploys from the lobby — but never while typing in a text
  // field (e.g. the GitHub export panel inputs).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Enter' || phaseRef.current !== 'lobby') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      enterGame();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterGame]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ================= height field (perlin noise) =================
    function generateHeight(width: number, height: number): number[] {
      const heights: number[] = [];
      const perlin = new ImprovedNoise();
      const size = width * height;
      const z = Math.random() * 100;

      let quality = 2;

      for (let j = 0; j < 4; j++) {
        if (j === 0) {
          for (let i = 0; i < size; i++) heights[i] = 0;
        }

        for (let i = 0; i < size; i++) {
          const x = i % width;
          const y = (i / width) | 0;
          heights[i] += perlin.noise(x / quality, y / quality, z) * quality;
        }

        quality *= 4;
      }

      return heights;
    }

    const heightData = generateHeight(WORLD_WIDTH, WORLD_DEPTH);

    function getY(x: number, z: number): number {
      return (heightData[x + z * WORLD_WIDTH] * 0.15) | 0;
    }

    /** Terrain surface height (top of the block) at a world-space position. */
    function surfaceYAt(worldX: number, worldZ: number): number {
      const gx = Math.min(
        WORLD_WIDTH - 1,
        Math.max(0, Math.round(worldX / BLOCK + WORLD_HALF_WIDTH))
      );
      const gz = Math.min(
        WORLD_DEPTH - 1,
        Math.max(0, Math.round(worldZ / BLOCK + WORLD_HALF_DEPTH))
      );
      return getY(gx, gz) * BLOCK + BLOCK / 2;
    }

    // ================= camera / scene =================
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      20000
    );

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfd1e5);

    const timer = new THREE.Timer();
    timer.connect(document);

    let renderer: THREE.WebGLRenderer;

    // ================= terrain geometry (merged voxel faces) =================
    const matrix = new THREE.Matrix4();

    const pxGeometry = new THREE.PlaneGeometry(BLOCK, BLOCK);
    pxGeometry.attributes.uv.array[1] = 0.5;
    pxGeometry.attributes.uv.array[3] = 0.5;
    pxGeometry.rotateY(Math.PI / 2);
    pxGeometry.translate(BLOCK / 2, 0, 0);

    const nxGeometry = new THREE.PlaneGeometry(BLOCK, BLOCK);
    nxGeometry.attributes.uv.array[1] = 0.5;
    nxGeometry.attributes.uv.array[3] = 0.5;
    nxGeometry.rotateY(-Math.PI / 2);
    nxGeometry.translate(-BLOCK / 2, 0, 0);

    const pyGeometry = new THREE.PlaneGeometry(BLOCK, BLOCK);
    pyGeometry.attributes.uv.array[5] = 0.5;
    pyGeometry.attributes.uv.array[7] = 0.5;
    pyGeometry.rotateX(-Math.PI / 2);
    pyGeometry.translate(0, BLOCK / 2, 0);

    const pzGeometry = new THREE.PlaneGeometry(BLOCK, BLOCK);
    pzGeometry.attributes.uv.array[1] = 0.5;
    pzGeometry.attributes.uv.array[3] = 0.5;
    pzGeometry.translate(0, 0, BLOCK / 2);

    const nzGeometry = new THREE.PlaneGeometry(BLOCK, BLOCK);
    nzGeometry.attributes.uv.array[1] = 0.5;
    nzGeometry.attributes.uv.array[3] = 0.5;
    nzGeometry.rotateY(Math.PI);
    nzGeometry.translate(0, 0, -BLOCK / 2);

    const geometries: THREE.BufferGeometry[] = [];

    for (let z = 0; z < WORLD_DEPTH; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const h = getY(x, z);

        matrix.makeTranslation(
          x * BLOCK - WORLD_HALF_WIDTH * BLOCK,
          h * BLOCK,
          z * BLOCK - WORLD_HALF_DEPTH * BLOCK
        );

        const px = getY(x + 1, z);
        const nx = getY(x - 1, z);
        const pz = getY(x, z + 1);
        const nz = getY(x, z - 1);

        geometries.push(pyGeometry.clone().applyMatrix4(matrix));

        if ((px !== h && px !== h + 1) || x === 0) {
          geometries.push(pxGeometry.clone().applyMatrix4(matrix));
        }

        if ((nx !== h && nx !== h + 1) || x === WORLD_WIDTH - 1) {
          geometries.push(nxGeometry.clone().applyMatrix4(matrix));
        }

        if ((pz !== h && pz !== h + 1) || z === WORLD_DEPTH - 1) {
          geometries.push(pzGeometry.clone().applyMatrix4(matrix));
        }

        if ((nz !== h && nz !== h + 1) || z === 0) {
          geometries.push(nzGeometry.clone().applyMatrix4(matrix));
        }
      }
    }

    const merged = BufferGeometryUtils.mergeGeometries(geometries);
    if (!merged) throw new Error('Failed to merge terrain geometries');
    const terrainGeometry: THREE.BufferGeometry = merged;
    terrainGeometry.computeBoundingSphere();

    const texture = new THREE.TextureLoader().load(
      '/textures/minecraft/atlas.png'
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;

    const material = new THREE.MeshLambertMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(terrainGeometry, material);
    terrain.receiveShadow = true; // player shadow lands here
    terrain.castShadow = true; // hills cast shadows into valleys
    scene.add(terrain);

    const ambientLight = new THREE.AmbientLight(0xeeeeee, 3);
    scene.add(ambientLight);

    // Day/night cycle: the sun orbits the world once per CYCLE_SECONDS and
    // the moon rides the opposite side of the sky. ONE directional light
    // plays both roles — warm bright sunlight by day, dim blue moonlight by
    // night, with real shadows in both phases — crossfading through a
    // near-zero intensity at dusk/dawn so the direction swap is invisible.
    // The light travels with the player so the shadow camera only needs to
    // cover the area around the character.
    const SUN_DISTANCE = 2600;
    const sunDir = new THREE.Vector3();
    const moonDir = new THREE.Vector3();
    let timeHour = DAY_START_HOUR; // 0..24, advances in the render loop

    function sunAngleFromHour(hour: number): number {
      // 6h = sunrise (east horizon), 12h = zenith, 18h = sunset (west)
      return ((hour - SUNRISE_HOUR) / 24) * Math.PI * 2;
    }

    function updateSunMoonDirections() {
      const a = sunAngleFromHour(timeHour);
      sunDir.set(Math.cos(a), Math.sin(a), 0.35).normalize();
      // Moon rides the opposite arc but keeps the same z-tilt as the sun,
      // so it rises in front of the default camera view instead of behind it.
      moonDir.set(-Math.cos(a), -Math.sin(a), 0.35).normalize();
    }

    updateSunMoonDirections();

    const directionalLight = new THREE.DirectionalLight(0xffffff, 12);
    directionalLight.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(2048, 2048);
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 8000;
    directionalLight.shadow.camera.left = -900;
    directionalLight.shadow.camera.right = 900;
    directionalLight.shadow.camera.top = 900;
    directionalLight.shadow.camera.bottom = -900;
    directionalLight.shadow.camera.updateProjectionMatrix();
    directionalLight.shadow.bias = -0.0004;
    directionalLight.shadow.normalBias = 3;
    scene.add(directionalLight);
    scene.add(directionalLight.target);

    // ================= sun & moon discs in the sky =================
    // The realistic circular sun keeps its runtime-generated radial-gradient
    // glow; it now rides the moving sun direction and dips below the horizon
    // at dusk, warming to deep orange as it sets. A canvas-painted moon
    // (shaded disc + craters + soft halo) rides the opposite direction and
    // rises as the sun sets. Both re-anchor to the camera every frame so
    // they read as infinitely far away.
    const SUN_VISUAL_DISTANCE = 15000; // inside camera.far (20000)

    function createSunTexture(): THREE.CanvasTexture {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas not supported');

      const gradient = ctx.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2
      );
      gradient.addColorStop(0, 'rgba(255, 255, 248, 1)'); // white-hot center
      gradient.addColorStop(0.1, 'rgba(255, 252, 235, 1)'); // bright core
      gradient.addColorStop(0.18, 'rgba(255, 240, 180, 0.95)'); // disc edge
      gradient.addColorStop(0.3, 'rgba(255, 214, 120, 0.5)'); // inner glow
      gradient.addColorStop(0.55, 'rgba(255, 196, 100, 0.16)'); // halo falloff
      gradient.addColorStop(1, 'rgba(255, 185, 90, 0)'); // fades into sky

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    const sunTexture = createSunTexture();
    const sunMaterial = new THREE.MeshBasicMaterial({
      map: sunTexture,
      transparent: true,
      depthWrite: false,
    });
    const sunMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4200, 4200),
      sunMaterial
    );
    sunMesh.position.copy(sunDir).multiplyScalar(SUN_VISUAL_DISTANCE);
    scene.add(sunMesh);

    // --- moon: pale shaded disc with craters, melting into a soft halo ---
    function createMoonTexture(): THREE.CanvasTexture {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas not supported');

      const r = size / 2;

      // outer glow halo + limb softening, drawn behind the solid disc
      const halo = ctx.createRadialGradient(r, r, 0, r, r, r);
      halo.addColorStop(0, 'rgba(255, 254, 244, 0.98)');
      halo.addColorStop(0.3, 'rgba(248, 243, 224, 0.95)');
      halo.addColorStop(0.42, 'rgba(232, 226, 203, 0.82)'); // disc edge
      halo.addColorStop(0.5, 'rgba(214, 216, 205, 0.35)'); // limb
      halo.addColorStop(0.6, 'rgba(190, 200, 210, 0.12)'); // inner halo
      halo.addColorStop(1, 'rgba(170, 190, 210, 0)'); // fades to sky
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      // disc interior: offset highlight (lit from the upper left)
      ctx.save();
      ctx.beginPath();
      ctx.arc(r, r, r * 0.42, 0, Math.PI * 2);
      ctx.clip();
      const body = ctx.createRadialGradient(
        r * 0.78,
        r * 0.72,
        r * 0.05,
        r,
        r,
        r * 0.48
      );
      body.addColorStop(0, 'rgba(255, 254, 246, 0.95)');
      body.addColorStop(0.6, 'rgba(242, 237, 216, 0.92)');
      body.addColorStop(1, 'rgba(203, 197, 174, 0.9)');
      ctx.fillStyle = body;
      ctx.fillRect(0, 0, size, size);

      // craters: fixed layout so the moon always looks the same
      const craters: Array<[number, number, number]> = [
        [0.4, 0.36, 0.1],
        [0.62, 0.5, 0.14],
        [0.45, 0.66, 0.09],
        [0.68, 0.7, 0.07],
        [0.3, 0.56, 0.06],
        [0.58, 0.28, 0.05],
        [0.74, 0.42, 0.075],
        [0.38, 0.48, 0.045],
        [0.52, 0.58, 0.035],
      ];
      for (const [cx, cy, cr] of craters) {
        const px = r + (cx - 0.5) * r * 0.72;
        const py = r + (cy - 0.5) * r * 0.72;
        const pr = cr * r;
        const craterGrad = ctx.createRadialGradient(
          px - pr * 0.25,
          py - pr * 0.25,
          pr * 0.1,
          px,
          py,
          pr
        );
        craterGrad.addColorStop(0, 'rgba(168, 162, 138, 0.55)');
        craterGrad.addColorStop(0.7, 'rgba(178, 172, 148, 0.4)');
        craterGrad.addColorStop(1, 'rgba(200, 195, 170, 0)');
        ctx.fillStyle = craterGrad;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    const moonTexture = createMoonTexture();
    const moonMaterial = new THREE.MeshBasicMaterial({
      map: moonTexture,
      transparent: true,
      depthWrite: false,
    });
    const moonMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600),
      moonMaterial
    );
    moonMesh.position.copy(moonDir).multiplyScalar(SUN_VISUAL_DISTANCE);
    scene.add(moonMesh);

    // --- stars: a dim field + sparse bright stars on a camera-following
    //     sphere; additive round sprites that fade in with the night ---
    function createStarSprite(): THREE.CanvasTexture {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas not supported');

      const gradient = ctx.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2
      );
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.85)');
      gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.22)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    const starSprite = createStarSprite();

    /** Uniform random directions on the sphere (y > -0.2), radius STAR_RADIUS. */
    function makeStarPositions(count: number): Float32Array {
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        let x = 0;
        let y = 0;
        let z = 0;
        do {
          x = Math.random() * 2 - 1;
          y = Math.random() * 2 - 1;
          z = Math.random() * 2 - 1;
        } while (x * x + y * y + z * z > 1 || y < -0.2);
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        arr[i * 3] = (x / len) * STAR_RADIUS;
        arr[i * 3 + 1] = (y / len) * STAR_RADIUS;
        arr[i * 3 + 2] = (z / len) * STAR_RADIUS;
      }
      return arr;
    }

    /** Slightly varied star tints (warm/cool whites) with random brightness. */
    function makeStarColors(count: number): Float32Array {
      const tints = [
        [1, 1, 1],
        [1, 0.94, 0.82],
        [0.82, 0.89, 1],
        [1, 0.85, 0.68],
      ];
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const tint = tints[(Math.random() * tints.length) | 0];
        const b = 0.4 + Math.random() * 0.6;
        arr[i * 3] = tint[0] * b;
        arr[i * 3 + 1] = tint[1] * b;
        arr[i * 3 + 2] = tint[2] * b;
      }
      return arr;
    }

    function createStars(count: number, pointSize: number): THREE.Points {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(makeStarPositions(count), 3)
      );
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(makeStarColors(count), 3)
      );
      const material = new THREE.PointsMaterial({
        map: starSprite,
        size: pointSize,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false; // the sphere follows the camera; never cull
      scene.add(points);
      return points;
    }

    const starsField = createStars(STAR_COUNT, 52);
    const starsBright = createStars(STAR_BRIGHT_COUNT, 120);
    starsField.add(starsBright); // share position + slow rotation

    // ================= MD2 character (ratamahatta + weapon) =================
    const character = new MD2Character();

    let loaded = false;
    let currentAnim = 'stand';
    let oneShot: string | null = null;
    let airborne = false;
    let vy = 0;
    /** Vertical offset lifting the model so its feet rest exactly on the ground. */
    let footOffset = 0;

    const pos = new THREE.Vector3(0, surfaceYAt(0, 0), 0);
    let yaw = 0;

    function playAnim(name: string, once: boolean, hold = false) {
      currentAnim = name;
      character.setAnimation(name);

      if (once) {
        oneShot = name;
        const meshes: Array<ActionMesh | null> = [
          character.meshBody as ActionMesh | null,
          character.meshWeapon as ActionMesh | null,
        ];
        for (const mesh of meshes) {
          const action = mesh?.activeAction;
          if (action) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = hold;
          }
        }
      }
    }

    function onAnimFinished() {
      oneShot = null;
    }

    character.onLoadComplete = () => {
      (window as unknown as { __char?: MD2Character }).__char = character;
      const body = character.meshBody;
      if (body) {
        // Normalize the raw Quake-scale model to ~CHAR_HEIGHT world units.
        const bbox = new THREE.Box3().setFromBufferAttribute(
          body.geometry.attributes.position as THREE.BufferAttribute
        );
        const rawHeight = bbox.max.y - bbox.min.y;
        const s = CHAR_HEIGHT / rawHeight;

        body.scale.setScalar(s);
        for (const weapon of character.weapons) weapon.scale.setScalar(s);
        footOffset = -s * bbox.min.y;
        character.root.position.y = pos.y + footOffset;
        character.scale = s;
      }

      character.setAnimation('stand');
      applyWeapon(0);
      applySkin(0);
      character.mixer?.addEventListener('finished', onAnimFinished);
      loaded = true;
    };

    character.loadParts({
      baseUrl: '/models/md2/ratamahatta/',
      body: 'ratamahatta.md2',
      skins: [
        'ratamahatta.png',
        'ctf_b.png',
        'ctf_r.png',
        'dead.png',
        'gearwhore.png',
      ],
      weapons: [
        ['weapon.md2', 'weapon.png'],
        ['w_shotgun.md2', 'w_shotgun.png'],
        ['w_chaingun.md2', 'w_chaingun.png'],
        ['w_railgun.md2', 'w_railgun.png'],
      ],
    });

    scene.add(character.root);

    // ================= vitals & loadout =================
    let skinIndex = 0;
    let weaponIndex = 0;
    let health = MAX_HEALTH;
    let stamina = MAX_STAMINA;
    let exhausted = false;
    let lastDamageAt = -1e9;
    let elapsed = 0;
    let deathTimer = 0; // > 0 while the death sequence plays
    let publishedSkin = -1; // loadout mirror change detection
    let publishedWeapon = -1;
    const spawnPos = new THREE.Vector3(0, surfaceYAt(0, 0), 0);

    function applySkin(index: number) {
      skinIndex = ((index % SKINS.length) + SKINS.length) % SKINS.length;
      character.setSkin(skinIndex);
    }

    /** Equips a loadout by index. Weapon meshes map 1:1 onto the loadout
     *  entries that have a model; the trailing Unarmed entry maps to -1,
     *  which makes the addon hide every weapon mesh. */
    function applyWeapon(index: number) {
      weaponIndex =
        ((index % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
      character.setWeapon(weaponIndex < WEAPONS.length - 1 ? weaponIndex : -1);
    }

    function applyDamage(amount: number) {
      if (deathTimer > 0) return;
      health = Math.max(0, health - amount);
      lastDamageAt = elapsed;

      if (health <= 0) {
        deathTimer = RESPAWN_DELAY;
        playAnim('death', true, true); // hold the final death pose
        keys.clear();
      } else if (!airborne) {
        playAnim('pain', true);
      }
    }

    function respawn() {
      pos.copy(spawnPos);
      vy = 0;
      airborne = false;
      yaw = 0;
      health = MAX_HEALTH;
      stamina = MAX_STAMINA;
      exhausted = false;
      deathTimer = 0;
      camYawOffset = 0;
      playAnim('stand', false);
      updateCamera(true, 0); // snap the camera behind the respawned player
    }

    apiRef.current = {
      setSkin: applySkin,
      setWeapon: applyWeapon,
      applyDamage,
      respawn,
    };
    (window as unknown as { __gameApi?: GameApi }).__gameApi = apiRef.current;

    // ================= input =================
    const keys = new Set<string>();

    /** Normalize to a stable code; falls back to event.key when code is empty
     *  (some automation tools and non-standard keyboards send no code). */
    function resolveCode(event: KeyboardEvent): string {
      if (event.code) return event.code;
      const key = event.key.toLowerCase();
      switch (key) {
        case 'w':
          return 'KeyW';
        case 'a':
          return 'KeyA';
        case 's':
          return 'KeyS';
        case 'd':
          return 'KeyD';
        case 'arrowup':
          return 'ArrowUp';
        case 'arrowdown':
          return 'ArrowDown';
        case 'arrowleft':
          return 'ArrowLeft';
        case 'arrowright':
          return 'ArrowRight';
        case ' ':
          return 'Space';
        case 'f':
          return 'KeyF';
        case 'q':
          return 'KeyQ';
        case 'e':
          return 'KeyE';
        case 'x':
          return 'KeyX';
        case 'escape':
          return 'Escape';
        default:
          return /^[1-5]$/.test(key) ? 'Digit' + key : '';
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const code = resolveCode(event);
      if (!code) return;

      if (code === 'Escape') {
        // Esc returns to the lobby (disabled during the death sequence)
        if (
          !event.repeat &&
          phaseRef.current === 'playing' &&
          deathTimer <= 0
        ) {
          hudBridgeRef.current.enterLobby?.();
        }
        return;
      }

      // all gameplay input is ignored while the lobby is showing
      if (phaseRef.current !== 'playing') return;

      if (
        code === 'Space' ||
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight'
      ) {
        event.preventDefault();
      }

      if (code === 'KeyQ' && !event.repeat && loaded) {
        applySkin(skinIndex - 1);
      } else if (code === 'KeyE' && !event.repeat && loaded) {
        applySkin(skinIndex + 1);
      } else if (code === 'KeyX' && !event.repeat && loaded) {
        applyWeapon(weaponIndex + 1);
      } else if (
        code === 'Space' &&
        !event.repeat &&
        loaded &&
        !airborne &&
        deathTimer <= 0 &&
        stamina >= STAMINA_JUMP_COST
      ) {
        airborne = true;
        vy = JUMP_SPEED;
        stamina -= STAMINA_JUMP_COST;
        playAnim('jump', true);
      } else if (
        ACTION_KEYS[code] &&
        !event.repeat &&
        loaded &&
        !airborne &&
        deathTimer <= 0
      ) {
        playAnim(ACTION_KEYS[code], true);
      }

      keys.add(code);
    }

    function onKeyUp(event: KeyboardEvent) {
      const code = resolveCode(event);
      if (code) keys.delete(code);
    }

    function onBlur() {
      keys.clear();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // ================= running sound =================
    // Loops while the character is actually running (moving + on the ground);
    // pauses on idle, jumps and one-shot emotes.
    const runSound = new Audio('/sounds/running-forest.wav');
    runSound.loop = true;
    runSound.volume = RUN_SOUND_VOLUME;
    runSound.preload = 'auto';
    let runSoundActive = false;

    function setRunSound(active: boolean) {
      if (active === runSoundActive) return;
      runSoundActive = active;

      if (active) {
        runSound.currentTime = 0;
        runSound.play().catch(() => {
          // Autoplay is rejected until the first user gesture; clear the flag
          // so the loop retries automatically on later frames.
          runSoundActive = false;
        });
      } else {
        runSound.pause();
      }
    }

    // ================= debug handle (invisible) =================
    const debug: PlayerDebugInfo = {
      loaded: false,
      animation: 'stand',
      moving: false,
      airborne: false,
      x: 0,
      y: 0,
      z: 0,
      charMinY: 0,
      charMaxY: 0,
      phase: 'lobby',
    };
    (window as unknown as { __player?: PlayerDebugInfo }).__player = debug;
    (window as unknown as { __runSound?: HTMLAudioElement }).__runSound =
      runSound;
    (window as unknown as {
      __dayNight?: {
        hour(): number;
        setHour(hour: number): void;
        sunHeight(): number;
        sunDir(): number[];
        moonDir(): number[];
        aim(dx: number, dy: number, dz: number): void;
      };
    }).__dayNight = {
      hour: () => timeHour,
      setHour: (hour: number) => {
        timeHour = ((hour % 24) + 24) % 24;
      },
      sunHeight: () => sunDir.y,
      sunDir: () => {
        updateSunMoonDirections();
        return sunDir.toArray();
      },
      moonDir: () => {
        updateSunMoonDirections();
        return moonDir.toArray();
      },
      // point the orbit camera along a world-space direction (debug/verification)
      aim: (dx: number, dy: number, dz: number) => {
        const horiz = Math.sqrt(dx * dx + dz * dz) || 1e-6;
        camYawOffset = Math.atan2(dx, dz) - yaw;
        camPitch = THREE.MathUtils.clamp(
          -Math.atan2(dy, horiz),
          CAM_MIN_PITCH,
          CAM_MAX_PITCH
        );
        camIgnoreClearance = true;
        updateCamera(true, 0);
      },
    };

    // ================= renderer =================
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    // place camera behind the character right away
    const camDesired = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();

    // --- mouse-controlled orbit / zoom state ---
    let camYawOffset = 0; // orbit angle around the character (rad)
    let camPitch = LOBBY_PITCH; // starts in the lobby showcase framing
    let camDist = LOBBY_DIST;
    let camDistTarget = LOBBY_DIST;
    let orbitDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    // --- lobby <-> gameplay camera blending ---
    // 1 = lobby showcase (camera in front of the character), 0 = gameplay
    // rig (camera behind). START tweens this to 0, sweeping the camera
    // around the character instead of hard cutting.
    let lobbyBlend = 1;
    let lastPhase: GamePhase = phaseRef.current;
    /** Debug aim() bypasses the terrain-clearance clamp so the camera can
     *  look up at the sky across hills; reset on every phase change. */
    let camIgnoreClearance = false;

    function onPointerDown(event: PointerEvent) {
      orbitDragging = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    }

    function onPointerMove(event: PointerEvent) {
      if (!orbitDragging) return;

      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;

      // in the lobby the drag spins the character's showcase turntable
      if (phaseRef.current === 'lobby') {
        yaw -= dx * 0.008;
        return;
      }

      camYawOffset -= dx * 0.005;
      camPitch = Math.min(
        CAM_MAX_PITCH,
        Math.max(CAM_MIN_PITCH, camPitch + dy * 0.005)
      );
    }

    function onPointerUp(event: PointerEvent) {
      orbitDragging = false;
      renderer.domElement.style.cursor = 'grab';
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      if (phaseRef.current === 'lobby') return; // no zoom in the lobby
      camDistTarget = Math.min(
        CAM_MAX_DIST,
        Math.max(CAM_MIN_DIST, camDistTarget + event.deltaY * 0.5)
      );
    }

    function updateCamera(immediate: boolean, dt: number) {
      // smooth zoom easing
      camDist += (camDistTarget - camDist) * Math.min(1, 10 * dt);

      // Blend the lobby framing (in front of the character, angle + PI) into
      // the gameplay rig (behind, angle + camYawOffset) with smoothstep, so
      // START sweeps the camera around the character instead of cutting.
      const blendT = 1 - lobbyBlend;
      const blendEase = blendT * blendT * (3 - 2 * blendT);
      const angleOffset = Math.PI * (1 - blendEase) + camYawOffset * blendEase;
      const pitch = LOBBY_PITCH + (camPitch - LOBBY_PITCH) * blendEase;
      const dist = LOBBY_DIST + (camDist - LOBBY_DIST) * blendEase;

      const angle = yaw + angleOffset;
      const sinA = Math.sin(angle);
      const cosA = Math.cos(angle);
      const horizontal = dist * Math.cos(pitch);
      const vertical = dist * Math.sin(pitch);

      camDesired.set(
        pos.x - sinA * horizontal,
        pos.y + LOOK_HEIGHT + vertical,
        pos.z - cosA * horizontal
      );

      if (immediate) {
        camera.position.copy(camDesired);
      } else {
        camera.position.lerp(camDesired, 1 - Math.exp(-6 * dt));
      }

      if (!camIgnoreClearance) {
        const minY =
          surfaceYAt(camera.position.x, camera.position.z) + CAM_MIN_CLEARANCE;
        if (camera.position.y < minY) camera.position.y = minY;
      }

      lookTarget.set(pos.x, pos.y + LOOK_HEIGHT, pos.z);
      camera.lookAt(lookTarget);
    }

    // ================= day/night sky driver =================
    // One directional light plays both sun and moon: warm bright daylight,
    // crossfaded through dusk into dim blue moonlight (real shadows in both
    // phases). The sky blends night -> day with an orange horizon band at
    // dawn/dusk; the sun/moon discs and star field re-anchor to the camera
    // every frame. Called once per frame AFTER the camera update.
    const skyColor = new THREE.Color();
    const tmpColorA = new THREE.Color();
    const tmpColorB = new THREE.Color();
    scene.background = skyColor; // mutated in place each frame

    function updateSky(dt: number) {
      updateSunMoonDirections();

      const sunUp = THREE.MathUtils.smoothstep(sunDir.y, -0.04, 0.16);
      const moonUp = THREE.MathUtils.smoothstep(moonDir.y, -0.04, 0.16);
      // 1 when the sun sits on the horizon (dawn/dusk), 0 at high day/deep night
      const horizonGlow =
        1 - THREE.MathUtils.smoothstep(Math.abs(sunDir.y), 0.02, 0.3);

      // --- directional light: sun by day, moon by night ---
      const wSun = sunUp * sunUp;
      const wMoon = moonUp;
      const wSum = wSun + wMoon;
      const lightDir = wSun >= wMoon ? sunDir : moonDir;
      directionalLight.position
        .copy(pos)
        .addScaledVector(lightDir, SUN_DISTANCE);
      directionalLight.target.position.copy(pos);
      directionalLight.intensity =
        wSun * SUN_LIGHT_MAX + wMoon * MOON_LIGHT_MAX;
      if (wSum > 1e-3) {
        tmpColorA
          .copy(SUNLIGHT_LOW)
          .lerp(SUNLIGHT_HIGH, THREE.MathUtils.clamp(sunDir.y / 0.45, 0, 1))
          .multiplyScalar(wSun);
        tmpColorB.copy(MOONLIGHT).multiplyScalar(wMoon);
        tmpColorA.add(tmpColorB).multiplyScalar(1 / wSum);
        directionalLight.color.copy(tmpColorA);
      }

      // --- ambient: dims and cools off at night ---
      ambientLight.color.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAY, sunUp);
      ambientLight.intensity =
        AMBIENT_NIGHT_I + (AMBIENT_DAY_I - AMBIENT_NIGHT_I) * sunUp;

      // --- sky: night -> day, tinted orange around the horizon crossings ---
      skyColor.copy(SKY_NIGHT).lerp(SKY_DAY, sunUp);
      skyColor.lerp(SKY_SUNSET, horizonGlow * (0.3 + 0.5 * sunUp));

      // --- sun disc: follows the real orbit, warming orange as it sets ---
      sunMesh.position
        .copy(camera.position)
        .addScaledVector(sunDir, SUN_VISUAL_DISTANCE);
      sunMesh.lookAt(camera.position);
      sunMaterial.opacity = THREE.MathUtils.smoothstep(sunDir.y, -0.09, 0.03);
      sunMaterial.color
        .copy(SUN_TINT_SET)
        .lerp(SUN_TINT_NOON, 1 - horizonGlow * 0.85);

      // --- moon disc: rides the opposite side of the sky ---
      moonMesh.position
        .copy(camera.position)
        .addScaledVector(moonDir, SUN_VISUAL_DISTANCE);
      moonMesh.lookAt(camera.position);
      moonMaterial.opacity = THREE.MathUtils.smoothstep(moonDir.y, -0.09, 0.03);

      // --- stars: fade in at night, drift very slowly ---
      starsField.position.copy(camera.position);
      starsField.rotation.y += dt * 0.005;
      (starsField.material as THREE.PointsMaterial).opacity = moonUp * 0.95;
      (starsBright.material as THREE.PointsMaterial).opacity = moonUp * 0.95;
    }

    updateCamera(true, 0);
    updateSky(0);

    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener('resize', onWindowResize);

    // ================= animation loop =================
    function animate() {
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.1);
      elapsed += dt;

      // --- lobby <-> gameplay phase transitions ---
      if (phaseRef.current !== lastPhase) {
        lastPhase = phaseRef.current;
        keys.clear();

        if (phaseRef.current === 'playing') {
          // deploy: gameplay orbit defaults; the camera sweeps via lobbyBlend
          camYawOffset = 0;
          camPitch = CAM_DEFAULT_PITCH;
          camDistTarget = CAM_DIST;
          camIgnoreClearance = false;
        } else {
          // back to the showcase: hard cut to the frontal framing
          camYawOffset = 0;
          camPitch = LOBBY_PITCH;
          camDistTarget = LOBBY_DIST;
          lobbyBlend = 1;
          setRunSound(false);
          oneShot = null;
        }
      }

      const inLobby = phaseRef.current === 'lobby';

      // lobby turntable: idle character slowly rotates for the showcase
      if (inLobby && deathTimer <= 0) yaw += LOBBY_TURN_SPEED * dt;

      // tween the camera from the lobby framing into the gameplay rig
      if (!inLobby && lobbyBlend > 0) {
        lobbyBlend = Math.max(0, lobbyBlend - dt / LOBBY_BLEND_TIME);
      }

      // --- movement input ---
      const controlsLocked = deathTimer > 0 || inLobby;
      let moveInput = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) moveInput += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) moveInput -= 1;

      const turnInput = controlsLocked
        ? 0
        : (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) -
          (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
      yaw += turnInput * TURN_SPEED * dt;

      const moving = moveInput !== 0 && !controlsLocked;

      if (moving && loaded) {
        const speed =
          (moveInput > 0 ? WALK_SPEED : BACK_SPEED) *
          (exhausted ? EXHAUSTED_SPEED_SCALE : 1);
        pos.x += Math.sin(yaw) * speed * dt * moveInput;
        pos.z += Math.cos(yaw) * speed * dt * moveInput;

        const limit = WORLD_HALF_WIDTH * BLOCK - BLOCK / 2;
        pos.x = Math.min(limit, Math.max(-limit, pos.x));
        pos.z = Math.min(limit, Math.max(-limit, pos.z));
      }

      // --- stamina ---
      const runningNow = moving && !airborne;
      if (runningNow) {
        stamina = Math.max(0, stamina - STAMINA_DRAIN_RATE * dt);
        if (stamina <= 0) exhausted = true;
      } else {
        stamina = Math.min(MAX_STAMINA, stamina + STAMINA_REGEN_RATE * dt);
        if (exhausted && stamina >= EXHAUSTED_RECOVER_AT) exhausted = false;
      }

      // --- health regen (after a damage-free grace period) ---
      if (
        deathTimer <= 0 &&
        health < MAX_HEALTH &&
        elapsed - lastDamageAt > HEALTH_REGEN_DELAY
      ) {
        health = Math.min(MAX_HEALTH, health + HEALTH_REGEN_RATE * dt);
      }

      // --- ground / gravity ---
      const groundY = surfaceYAt(pos.x, pos.z);
      if (airborne) {
        vy -= GRAVITY * dt;
        pos.y += vy * dt;
        if (pos.y <= groundY) {
          pos.y = groundY;
          const impact = -vy;
          vy = 0;
          airborne = false;

          if (impact > FALL_DAMAGE_MIN_SPEED) {
            applyDamage(
              Math.min(
                MAX_HEALTH,
                (impact - FALL_DAMAGE_MIN_SPEED) * FALL_DAMAGE_SCALE
              )
            );
          }
        }
      } else {
        pos.y += (groundY - pos.y) * Math.min(1, 12 * dt);
      }

      character.root.position.set(pos.x, pos.y + footOffset, pos.z);
      character.root.rotation.y = yaw;

      // advance the in-game clock (full 24h every CYCLE_SECONDS)
      timeHour = (timeHour + (24 / CYCLE_SECONDS) * dt) % 24;

      // --- animation state machine / death sequence ---
      if (deathTimer > 0) {
        deathTimer -= dt;
        if (deathTimer <= 0) respawn();
      } else {
        const desired = oneShot ?? (airborne ? 'jump' : moving ? 'run' : 'stand');
        if (loaded && desired !== currentAnim) {
          playAnim(desired, false);
        }
      }

      character.update(dt);

      // --- running sound ---
      setRunSound(loaded && moving && !airborne);

      // --- camera + sky (sky re-anchors to the final camera position) ---
      updateCamera(false, dt);
      updateSky(dt);

      renderer.render(scene, camera);

      // --- debug info ---
      const charBox = new THREE.Box3().setFromObject(character.root);
      debug.loaded = loaded;
      debug.animation = currentAnim;
      debug.moving = moving;
      debug.airborne = airborne;
      debug.x = pos.x;
      debug.y = pos.y;
      debug.z = pos.z;
      debug.charMinY = Math.round(charBox.min.y);
      debug.charMaxY = Math.round(charBox.max.y);
      debug.timeOfDay = timeHour;
      debug.phase = phaseRef.current;

      // --- loadout mirror for the LOBBY pickers: publishes on change only.
      //     The in-game view itself is completely UI-free. ---
      if (skinIndex !== publishedSkin || weaponIndex !== publishedWeapon) {
        publishedSkin = skinIndex;
        publishedWeapon = weaponIndex;
        hudBridgeRef.current.publish?.({ skinIndex, weaponIndex });
      }
    }

    renderer.setAnimationLoop(animate);

    // ================= cleanup =================
    return () => {
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);

      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);

      renderer.setAnimationLoop(null);

      setRunSound(false);
      runSound.pause();
      runSound.src = '';
      delete (window as unknown as { __runSound?: HTMLAudioElement }).__runSound;

      apiRef.current = null;
      delete (window as unknown as { __gameApi?: GameApi }).__gameApi;

      character.mixer?.stopAllAction();
      const meshes = [character.meshBody, ...character.weapons];
      for (const mesh of meshes) {
        if (!mesh) continue;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          const lambert = mat as THREE.MeshLambertMaterial;
          lambert.map?.dispose();
          lambert.dispose();
        }
      }
      for (const skin of [...character.skinsBody, ...character.skinsWeapon]) {
        skin.dispose();
      }
      scene.remove(character.root);

      terrainGeometry.dispose();
      material.dispose();
      texture.dispose();
      scene.remove(sunMesh);
      sunMesh.geometry.dispose();
      sunMaterial.map?.dispose();
      sunMaterial.dispose();

      scene.remove(moonMesh);
      moonMesh.geometry.dispose();
      moonMaterial.map?.dispose();
      moonMaterial.dispose();

      scene.remove(starsField);
      starsField.geometry.dispose();
      (starsField.material as THREE.PointsMaterial).dispose();
      starsBright.geometry.dispose();
      (starsBright.material as THREE.PointsMaterial).dispose();
      starSprite.dispose();
      timer.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      delete (window as unknown as { __player?: PlayerDebugInfo }).__player;
      delete (window as unknown as { __char?: MD2Character }).__char;
      delete (window as unknown as {
        __dayNight?: {
          hour(): number;
          setHour(hour: number): void;
          sunHeight(): number;
          sunDir(): number[];
          moonDir(): number[];
          aim(dx: number, dy: number, dz: number): void;
        };
      }).__dayNight;
    };
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#bfd1e5]">
      <div ref={containerRef} className="absolute inset-0" />

      {/* ================= LOBBY dashboard overlay ================= */}
      {phase === 'lobby' && (
        <div className="pointer-events-none absolute inset-0 z-10 select-none">
          {/* readability scrims over the 3D showcase */}
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-zinc-950/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-zinc-950/70 to-transparent" />

          {/* top-left: profile + currency */}
          <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-zinc-950/70 p-1.5 pr-4 shadow-xl backdrop-blur-md sm:left-5 sm:top-4">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-amber-300 to-orange-600 text-base font-black text-zinc-950 sm:h-10 sm:w-10">
              {PLAYER_NAME.charAt(0)}
            </div>
            <div className="leading-tight">
              <p className="text-xs font-black tracking-wide text-zinc-100 sm:text-sm">
                {PLAYER_NAME}
              </p>
              <div className="mt-0.5 flex items-center gap-3 text-[10px] font-bold text-zinc-300">
                <span className="flex items-center gap-1">
                  <Coins className="h-3 w-3 text-amber-400" aria-hidden />
                  {PLAYER_COINS}
                </span>
                <span className="flex items-center gap-1">
                  <Gem className="h-3 w-3 text-emerald-400" aria-hidden />
                  {PLAYER_GEMS}
                </span>
              </div>
            </div>
          </div>

          {/* top-right: game logo */}
          <div className="absolute right-3 top-2 text-right sm:right-5 sm:top-3">
            <h1 className="text-2xl font-black italic leading-none tracking-tighter text-zinc-50 drop-shadow-[0_2px_0_rgba(0,0,0,0.55)] sm:text-4xl">
              RAT<span className="text-amber-400">FIRE</span>
            </h1>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.35em] text-zinc-300 sm:text-[10px]">
              Classic · Bermuda
            </p>
          </div>

          {/* left menu */}
          <nav
            aria-label="Lobby menu"
            className="pointer-events-auto absolute left-3 top-[4.75rem] flex flex-col gap-1.5 sm:left-5 sm:top-24 sm:gap-2"
          >
            {LOBBY_MENU.map((item) => {
              const MenuIcon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.blur();
                    handleMenuClick(item.id);
                  }}
                  className="flex w-32 items-center gap-2.5 rounded-lg border border-zinc-700/50 bg-zinc-950/60 px-3 py-2 text-left backdrop-blur-md transition-all hover:border-amber-400/60 hover:bg-zinc-900/80 hover:pl-4 sm:w-44"
                >
                  <MenuIcon
                    className="h-4 w-4 shrink-0 text-amber-400"
                    aria-hidden
                  />
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-200 sm:text-xs">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* loadout picker panel (CHARACTER / WEAPONS) */}
          {lobbyPanel && (
            <section className="pointer-events-auto absolute bottom-24 left-1/2 w-[min(92vw,34rem)] -translate-x-1/2 rounded-2xl border border-zinc-700/60 bg-zinc-950/85 p-4 shadow-2xl backdrop-blur-xl sm:bottom-28">
              <div className="flex items-center justify-between border-b border-zinc-700/60 pb-2">
                <h2 className="text-xs font-black uppercase tracking-[0.25em] text-zinc-100">
                  {lobbyPanel === 'character' ? 'Character' : 'Weapons'}
                </h2>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.blur();
                    setLobbyPanel(null);
                  }}
                  aria-label="Close panel"
                  className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>

              {lobbyPanel === 'character' ? (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {SKINS.map((skin, index) => (
                    <button
                      key={skin.name}
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.blur();
                        apiRef.current?.setSkin(index);
                      }}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition-all ${
                        loadout.skinIndex === index
                          ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/60'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800'
                      }`}
                    >
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-zinc-700"
                        style={{ backgroundColor: skin.color }}
                      />
                      <span className="truncate">{skin.name}</span>
                      {loadout.skinIndex === index && (
                        <Check
                          className="ml-auto h-3.5 w-3.5 shrink-0"
                          aria-hidden
                        />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {WEAPONS.map((weapon, index) => {
                    const WeaponIcon = weapon.icon;
                    return (
                      <button
                        key={weapon.name}
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.blur();
                          apiRef.current?.setWeapon(index);
                        }}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition-all ${
                          loadout.weaponIndex === index
                            ? 'border-amber-400 bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/60'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800'
                        }`}
                      >
                        <WeaponIcon
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden
                        />
                        <span className="truncate">{weapon.name}</span>
                        {loadout.weaponIndex === index && (
                          <Check
                            className="ml-auto h-3.5 w-3.5 shrink-0"
                            aria-hidden
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="mt-3 border-t border-zinc-700/60 pt-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Equipped live on your character — click START to deploy
              </p>
            </section>
          )}

          {/* transient toast for decorative menu entries */}
          {toast && (
            <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-amber-400/40 bg-zinc-950/85 px-5 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-amber-300 shadow-xl backdrop-blur-md">
              {toast}
            </div>
          )}

          {/* bottom-left hint */}
          <p className="absolute bottom-5 left-4 hidden text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400/90 sm:block">
            Drag to rotate · Enter to deploy
          </p>

          {/* bottom-centre: push the whole game source to GitHub */}
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.blur();
              setGhOpen(true);
            }}
            aria-label="Save source code to GitHub"
            aria-haspopup="dialog"
            className="pointer-events-auto group absolute bottom-5 left-1/2 z-20 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-2 border-zinc-600/60 bg-zinc-950/75 text-zinc-200 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.8)] backdrop-blur-md transition-all duration-200 hover:scale-110 hover:border-amber-400/70 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 active:scale-95 sm:bottom-8 sm:h-16 sm:w-16"
          >
            <GithubMark
              className="h-6 w-6 transition-transform duration-200 group-hover:rotate-6 sm:h-7 sm:w-7"
            />
          </button>

          {/* START */}
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.blur();
              enterGame();
            }}
            aria-label="Start game"
            className="group pointer-events-auto absolute bottom-5 right-4 outline-none sm:bottom-8 sm:right-8"
          >
            <span className="flex -skew-x-12 items-center bg-gradient-to-b from-amber-300 via-amber-400 to-orange-500 py-3 pl-7 pr-5 shadow-[0_10px_40px_-10px_rgba(251,146,60,0.9)] ring-1 ring-amber-200/70 transition-all duration-200 group-hover:scale-105 group-hover:shadow-[0_12px_50px_-8px_rgba(251,146,60,1)] group-focus-visible:ring-2 group-focus-visible:ring-white group-active:scale-95 sm:py-4 sm:pl-11 sm:pr-7">
              <span className="flex skew-x-12 items-center gap-2.5 text-xl font-black italic tracking-[0.12em] text-zinc-950 sm:text-2xl">
                START
                <Play
                  className="h-5 w-5 fill-zinc-950 sm:h-6 sm:w-6"
                  aria-hidden
                />
              </span>
            </span>
          </button>
        </div>
      )}

      {/* ================= GitHub export panel (centre modal) ================= */}
      {ghOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Save source code to GitHub"
          className="absolute inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close GitHub panel"
            onClick={() => setGhOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-zinc-950/70 backdrop-blur-sm focus-visible:outline-none"
          />
          <section className="relative w-[min(92vw,26rem)] rounded-2xl border border-amber-400/30 bg-zinc-950/95 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
            <div className="flex items-center justify-between border-b border-zinc-700/60 pb-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-950">
                  <GithubMark className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="text-sm font-black uppercase tracking-[0.22em] text-zinc-100">
                    Push to GitHub
                  </h2>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                    Back up the full game source
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGhOpen(false)}
                aria-label="Close GitHub panel"
                className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {ghStatus === 'success' ? (
              <div className="mt-4 space-y-4">
                <p className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                  <Check className="h-4 w-4 shrink-0" aria-hidden />
                  Saved {ghFiles} source files to GitHub
                </p>
                <a
                  href={ghUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-xs font-bold text-amber-300 underline underline-offset-4 transition-colors hover:bg-amber-400/20"
                >
                  {ghUrl}
                </a>
                <p className="text-[10px] font-semibold uppercase leading-snug tracking-widest text-zinc-500">
                  The repository opens in a new tab — every future save adds a
                  fresh commit.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setGhStatus('idle')}
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
                  >
                    Save to another repo
                  </button>
                  <button
                    type="button"
                    onClick={() => setGhOpen(false)}
                    className="flex-1 rounded-lg bg-gradient-to-b from-amber-300 via-amber-400 to-orange-500 px-3 py-2.5 text-xs font-black uppercase tracking-widest text-zinc-950 transition-all hover:brightness-110"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="mt-4 space-y-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveToGithub();
                }}
              >
                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    GitHub token
                  </span>
                  <div className="relative">
                    <input
                      type={ghShowToken ? 'text' : 'password'}
                      value={ghToken}
                      onChange={(event) => setGhToken(event.target.value)}
                      placeholder="ghp_… or github_pat_…"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 pl-3 pr-10 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setGhShowToken((value) => !value)}
                      aria-label={ghShowToken ? 'Hide token' : 'Show token'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"
                    >
                      {ghShowToken ? (
                        <EyeOff className="h-4 w-4" aria-hidden />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </div>
                  <span className="mt-1 block text-[10px] leading-snug text-zinc-500">
                    Used only for this request and never stored. Needs a classic
                    token with the "repo" scope — or a fine-grained token with
                    Contents + Administration read &amp; write.{' '}
                    <a
                      href="https://github.com/settings/tokens/new"
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-nowrap font-bold text-amber-400 underline underline-offset-2 transition-colors hover:text-amber-300"
                    >
                      Create / verify a token on GitHub ↗
                    </a>
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Repository name
                  </span>
                  <input
                    type="text"
                    value={ghRepo}
                    onChange={(event) => setGhRepo(event.target.value)}
                    placeholder="my-ratfire-game"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none"
                  />
                  <span className="mt-1 block text-[10px] leading-snug text-zinc-500">
                    Created under your account on save — or updated with a new
                    commit if it already exists.
                  </span>
                </label>

                {ghStatus === 'error' && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold leading-snug text-red-300"
                  >
                    {ghError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={
                    ghStatus === 'working' || !ghToken.trim() || !ghRepo.trim()
                  }
                  className="flex w-full -skew-x-12 items-center justify-center bg-gradient-to-b from-amber-300 via-amber-400 to-orange-500 py-3 ring-1 ring-amber-200/70 transition-all duration-200 enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="flex skew-x-12 items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-zinc-950">
                    {ghStatus === 'working' ? (
                      <>
                        <LoaderCircle
                          className="h-4 w-4 animate-spin"
                          aria-hidden
                        />
                        {ghStep}
                      </>
                    ) : (
                      'Save'
                    )}
                  </span>
                </button>
              </form>
            )}
          </section>
        </div>
      )}

    </main>
  );
}
