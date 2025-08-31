
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF, Center } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";

// Ready Player Me model URL
const GLB_URL = "https://models.readyplayer.me/68b3edee83ef17237fae055b.glb";

const sourceMap = new WeakMap();

function Avatar({ audioEl }) {
  const { scene } = useGLTF(GLB_URL, true);

  useEffect(() => {
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const n = (obj.name || "").toLowerCase();
      const keep =
        n.includes("head") ||
        n.includes("hair") ||
        n.includes("teeth") ||
        n.includes("brow") ||
        n.includes("lash") ||
        n.includes("eye") ||
        n.includes("eyelid");
      obj.visible = keep;
    });
  }, [scene]);


  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const audioCtxRef = useRef(null);

  useEffect(() => {
    if (!audioEl) return;

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = ctx;

    let src = sourceMap.get(audioEl);
    if (!src) {
      src = ctx.createMediaElementSource(audioEl);
      sourceMap.set(audioEl, src);
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    analyser.connect(ctx.destination);

    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

    return () => {
      try { src.disconnect(analyser); } catch {}
      try { analyser.disconnect(); } catch {}
      try { ctx.close(); } catch {}
      analyserRef.current = null;
      dataArrayRef.current = null;
      audioCtxRef.current = null;
    };
  }, [audioEl]);

  const morphMesh = useMemo(() => {
    let found = null;
    scene.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) {
        const dict = o.morphTargetDictionary;
        if ("jawOpen" in dict || "JawOpen" in dict || "mouthOpen" in dict) found = o;
      }
    });
    if (!found) {
      scene.traverse((o) => {
        if (o.isMesh && o.morphTargetDictionary && !found) found = o;
      });
    }
    return found;
  }, [scene]);


  const rotateGroupRef = useRef();
  const tRef = useRef(0);

  useFrame((_, delta) => {

    if (morphMesh && analyserRef.current && dataArrayRef.current) {
      const arr = dataArrayRef.current;
      analyserRef.current.getByteTimeDomainData(arr);

      let sum = 0;
      for (let i = 0; i < arr.length; i++) {
        const v = (arr[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / arr.length);
      const open = Math.min(1, rms * 2.0);

      const dict = morphMesh.morphTargetDictionary || {};
      const idx = (dict.jawOpen ?? dict.JawOpen ?? dict.mouthOpen);
      if (idx !== undefined && morphMesh.morphTargetInfluences) {
        const cur = morphMesh.morphTargetInfluences[idx] ?? 0;
        morphMesh.morphTargetInfluences[idx] =
          cur + (open - cur) * 0.28; // smoothing
      }
    }

    tRef.current += delta;
    const g = rotateGroupRef.current;
    if (g) {
      g.rotation.y = Math.sin(tRef.current * 0.5) * 0.14; 
      g.rotation.x = Math.sin(tRef.current * 0.7) * 0.02; 
    }
  });

  return (
    <Center disableY>
      <group ref={rotateGroupRef}>
        <primitive object={scene} />
      </group>
    </Center>
  );
}

export default function Mascot({ audioEl, size = 240 }) {
  return (
    <div style={{ width: size, height: size }}>
      <Canvas camera={{ position: [0, 0.85, 1.1], fov: 22 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={1.2} />
        <Avatar audioEl={audioEl} />
        <Environment preset="studio" />
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 2}
          target={[0, 0.7, 0]}
        />
      </Canvas>
    </div>
  );
}

useGLTF.preload(GLB_URL);

