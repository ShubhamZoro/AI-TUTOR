


import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF, Center } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";

const GLB_URL = "https://models.readyplayer.me/68b3edee83ef17237fae055b.glb";

// Shared WebAudio per HTMLAudioElement
function getOrInitSharedMediaSource(audioEl) {
  if (!audioEl) return null;
  if (audioEl._mascotShared) return audioEl._mascotShared;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();

  const source = ctx.createMediaElementSource(audioEl);

  // Route to speakers
  const gain = ctx.createGain();
  gain.gain.value = 1.0;
  source.connect(gain);
  gain.connect(ctx.destination);

  const shared = { ctx, source };
  audioEl._mascotShared = shared;

  // Resume context on user gesture / play
  const tryResume = async () => {
    if (shared.ctx?.state === "suspended") {
      try { await shared.ctx.resume(); } catch {}
    }
  };
  const onGesture = () => tryResume();
  const onPlay = () => tryResume();

  window.addEventListener("pointerdown", onGesture, { passive: true });
  window.addEventListener("keydown", onGesture, { passive: true });
  window.addEventListener("touchstart", onGesture, { passive: true });
  audioEl.addEventListener("play", onPlay);

  return shared;
}

function Avatar({ audioEl }) {
  const { scene } = useGLTF(GLB_URL, true);

  useEffect(() => {
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const n = (obj.name || "").toLowerCase();
      obj.visible =
        n.includes("head") ||
        n.includes("hair") ||
        n.includes("teeth") ||
        n.includes("brow") ||
        n.includes("lash") ||
        n.includes("eye") ||
        n.includes("eyelid");
    });
  }, [scene]);

  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const sharedRef = useRef(null);

  useEffect(() => {
    if (!audioEl) return;
    const shared = getOrInitSharedMediaSource(audioEl);
    sharedRef.current = shared;

    const analyser = shared.ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.1;
    shared.source.connect(analyser);

    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

    return () => {
      if (analyserRef.current) {
        try { shared.source.disconnect(analyserRef.current); } catch {}
      }
      analyserRef.current = null;
      dataArrayRef.current = null;
    };
  }, [audioEl]);

  const headMesh = useMemo(() => {
    let found = null;
    scene.traverse((obj) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.name === "Wolf3D_Head") {
        found = obj;
      }
    });
    return found;
  }, [scene]);

  const { mouthIndex, smileIndex } = useMemo(() => {
    let mi = -1, si = -1;
    if (headMesh?.morphTargetDictionary) {
      const dict = headMesh.morphTargetDictionary;
      const keys = Object.keys(dict).map((k) => k.toLowerCase());

      const findKey = (cands) =>
        cands.map((c) =>
          keys.findIndex((k) =>
            k === c ||
            k.endsWith(`.${c}`) ||
            (c.includes("mouth") && k.includes("mouth") && k.includes("open"))
          )
        ).find((idx) => idx >= 0);

      const miIdx = findKey(["mouthopen", "jawopen", "vrc.v_aa", "viseme_aa", "open"]);
      const siIdx = findKey(["mouthsmile", "smile", "smileleft", "smileright"]);

      if (miIdx >= 0) mi = Object.values(dict)[miIdx];
      if (siIdx >= 0) si = Object.values(dict)[siIdx];
    }
    return { mouthIndex: mi, smileIndex: si };
  }, [headMesh]);

  const rotateGroupRef = useRef();
  const tRef = useRef(0);

  useFrame((_, delta) => {
    tRef.current += delta;
    const g = rotateGroupRef.current;
    if (g) {
      g.rotation.y = Math.sin(tRef.current * 0.5) * 0.14;
      g.rotation.x = Math.sin(tRef.current * 0.7) * 0.02;
    }

    if (
      headMesh &&
      analyserRef.current &&
      dataArrayRef.current &&
      audioEl &&
      mouthIndex >= 0
    ) {
      const isPlaying = !audioEl.paused && !audioEl.ended && audioEl.currentTime > 0;

      if (isPlaying) {
        const analyser = analyserRef.current;
        const dataArray = dataArrayRef.current;
        analyser.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const mouthOpenAmount = Math.min(1, rms * 8.0);

        const influences = headMesh.morphTargetInfluences;
        if (influences) {
          const current = influences[mouthIndex] || 0;
          influences[mouthIndex] = current + (mouthOpenAmount - current) * 0.5;
          if (smileIndex >= 0 && mouthOpenAmount > 0.1) {
            influences[smileIndex] = Math.min(0.3, mouthOpenAmount * 0.5);
          }
        }
      } else {
        const influences = headMesh.morphTargetInfluences;
        if (influences) {
          influences[mouthIndex] *= 0.85;
          if (smileIndex >= 0) influences[smileIndex] *= 0.85;
        }
      }
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



