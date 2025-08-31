import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF, Center } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";

// Ready Player Me model URL
const GLB_URL = "https://models.readyplayer.me/68b3edee83ef17237fae055b.glb";

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
  const sourceRef = useRef(null);
  const isSetupRef = useRef(false);

  useEffect(() => {
    if (!audioEl || isSetupRef.current) return;

    const setupAudio = async () => {
      try {
        // Wait for user interaction to create audio context
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;

        // Create source from audio element
        const source = ctx.createMediaElementSource(audioEl);
        sourceRef.current = source;

        // Create analyser with better settings for speech
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256; // Smaller for faster response
        analyser.smoothingTimeConstant = 0.1; // Less smoothing for quicker response

        // Connect the audio graph
        source.connect(analyser);
        analyser.connect(ctx.destination);

        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
        isSetupRef.current = true;

        console.log("Audio context set up successfully");

      } catch (error) {
        console.error("Audio setup failed:", error);
      }
    };

    // Set up when audio plays to ensure user interaction
    const handlePlay = async () => {
      if (!isSetupRef.current) {
        await setupAudio();
      }
      
      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume();
        console.log("Audio context resumed");
      }
    };

    const handleEnded = () => {
      console.log("Audio ended");
    };

    audioEl.addEventListener('play', handlePlay);
    audioEl.addEventListener('ended', handleEnded);

    return () => {
      audioEl.removeEventListener('play', handlePlay);
      audioEl.removeEventListener('ended', handleEnded);
      
      // Cleanup
      if (sourceRef.current && analyserRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
      }
      if (analyserRef.current && audioCtxRef.current) {
        try { analyserRef.current.disconnect(); } catch {}
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch {}
      }
      
      analyserRef.current = null;
      dataArrayRef.current = null;
      audioCtxRef.current = null;
      sourceRef.current = null;
      isSetupRef.current = false;
    };
  }, [audioEl]);

  // Find the Wolf3D_Head mesh specifically
  const headMesh = useMemo(() => {
    let found = null;
    scene.traverse((obj) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.name === 'Wolf3D_Head') {
        found = obj;
        console.log("Found Wolf3D_Head with morph targets:", Object.keys(obj.morphTargetDictionary));
      }
    });
    return found;
  }, [scene]);

  const rotateGroupRef = useRef();
  const tRef = useRef(0);

  useFrame((_, delta) => {
    // Handle lip sync animation
    if (headMesh && analyserRef.current && dataArrayRef.current && audioEl) {
      const isPlaying = !audioEl.paused && !audioEl.ended && audioEl.currentTime > 0;
      
      if (isPlaying) {
        const analyser = analyserRef.current;
        const dataArray = dataArrayRef.current;
        
        // Get time domain data for better speech detection
        analyser.getByteTimeDomainData(dataArray);
        
        // Calculate RMS volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        
        // Convert to mouth opening with higher sensitivity
        const mouthOpenAmount = Math.min(1, rms * 8.0); // Increased sensitivity
        
        const dict = headMesh.morphTargetDictionary;
        const influences = headMesh.morphTargetInfluences;
        
        if (influences && dict.mouthOpen !== undefined) {
          const current = influences[dict.mouthOpen] || 0;
          influences[dict.mouthOpen] = current + (mouthOpenAmount - current) * 0.5; // Faster response
          
          // Also check if there are other mouth targets to animate
          if (dict.mouthSmile !== undefined && mouthOpenAmount > 0.1) {
            influences[dict.mouthSmile] = Math.min(0.3, mouthOpenAmount * 0.5);
          }
        }
        
        // Debug: Log the mouth open amount when there's audio
        if (mouthOpenAmount > 0.01) {
          console.log("Mouth open amount:", mouthOpenAmount.toFixed(3));
        }
        
      } else {
        // Gradually close mouth when not speaking
        const influences = headMesh.morphTargetInfluences;
        const dict = headMesh.morphTargetDictionary;
        
        if (influences && dict.mouthOpen !== undefined) {
          influences[dict.mouthOpen] *= 0.85; // Gradually close
        }
        if (influences && dict.mouthSmile !== undefined) {
          influences[dict.mouthSmile] *= 0.85;
        }
      }
    }

    // Handle gentle head movement animation
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
