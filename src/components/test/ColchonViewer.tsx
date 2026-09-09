import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const MODEL_URL = '/models/colchon.glb';

/**
 * Product-viewer style GLTF renderer: orbit-drag to rotate, scroll to zoom,
 * gentle idle auto-rotate + float. Model is centered/scaled to fit on load
 * since we don't control the source asset's origin or units.
 *
 * The canvas itself is transparent — the panel's background comes from the
 * container's `bg-slate-950` Tailwind class instead of `scene.background`,
 * so it reuses the app's existing (already theme-aware) CSS variables
 * rather than re-deriving them through three's own color-management pass.
 */
export default function ColchonViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frameId = 0;
    let floatBase = 0;
    let model: THREE.Group | null = null;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(2.4, 1.5, 2.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Soft studio-style reflections without needing an external HDR asset.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 12;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.bias = -0.0015;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x5a8ff0, 1.2);
    rim.position.set(-4, 2.5, -3);
    scene.add(rim);

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    // Invisible plane that only ever shows the model's cast shadow — keeps
    // the "floating" mattress grounded instead of looking like it's in a void.
    const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), new THREE.ShadowMaterial({ opacity: 0.32 }));
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.3;
    controls.maxDistance = 6;
    controls.minPolarAngle = Math.PI * 0.12;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.target.set(0, 0.2, 0);

    let idleTimer = 0;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      window.clearTimeout(idleTimer);
    });
    controls.addEventListener('end', () => {
      idleTimer = window.setTimeout(() => {
        controls.autoRotate = true;
      }, 2500);
    });

    const clock = new THREE.Clock();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        model.traverse((obj) => {
          if (obj instanceof THREE.Mesh) obj.castShadow = true;
        });

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 1.8 / maxDim;
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        floatBase = model.position.y;

        scene.add(model);
        controls.update();
        setLoaded(true);
      },
      (evt) => {
        if (evt.total) setProgress(Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
      },
      (err) => {
        console.error('Error cargando el modelo del colchón', err);
        if (!disposed) setError('No se pudo cargar el modelo 3D.');
      },
    );

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const animate = () => {
      if (disposed) return;
      frameId = requestAnimationFrame(animate);
      if (model) {
        model.position.y = floatBase + Math.sin(clock.getElapsedTime() * 1.1) * 0.05;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(idleTimer);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      });
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[70vh] min-h-[420px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
      />

      {!loaded && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-950/85">
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-slate-400">Cargando colchón… {progress}%</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/85">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {loaded && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-slate-400">
          Arrastrá para girar · Scroll para acercar
        </p>
      )}
    </div>
  );
}
