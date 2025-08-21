import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { useLoader, useThree } from "@react-three/fiber";
import { TextureLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";


export const myCompSchema = z.object({
  backgroundColor: zColor().default("#00ff00"),
  assetType: z.enum(["image", "model"]).default("image"),
  assetSrc: z.string().default("/image.png"),
  spawnCount: z.number().int().min(1).max(500).default(50),
  seed: z.number().int().min(0).max(1000000).default(42),
  fallSpeed: z.number().min(0.01).max(10).default(1.5),
  itemScale: z.number().min(0.01).max(5).default(0.8),
});

type MyCompSchemaType = z.infer<typeof myCompSchema>;

// Simple seeded RNG for deterministic randomness per render
const makeRng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff);
  };
};

const SceneSetup: React.FC = () => {
  const camera = useThree((s) => s.camera);
  React.useEffect(() => {
    camera.position.set(0, 0, 10);
    camera.near = 0.1;
    camera.far = 1000;
    camera.lookAt(0, 0, 0);
    // Adjust FOV so that the visible vertical half-height at z=0 is 5 world units
    // This aligns with yStart=5 and yEnd≈-5.5 and allows us to compute full screen width precisely
    // halfHeight = tan(fov/2) * distance => fov = 2 * atan(halfHeight/distance)
    const distance = Math.abs(camera.position.z);
    const halfHeight = 5;
    // Only set if perspective camera (has fov)
    // @ts-expect-error three types: checking existence at runtime
    if (camera.fov !== undefined) {
      // @ts-expect-error property exists on PerspectiveCamera
      camera.fov = (2 * Math.atan(halfHeight / distance)) * 180 / Math.PI;
      camera.updateProjectionMatrix();
    }
  }, [camera]);
  return null;
};

const ImageItem: React.FC<{ src: string; scale: number } & { rotation: number }> = ({ src, scale, rotation }) => {
  const texture = useLoader(TextureLoader, src);
  // Keep aspect ratio by reading image width/height from texture once loaded
  const aspect = (texture.image?.width && texture.image?.height)
    ? texture.image.width / texture.image.height
    : 1;
  return (
    <mesh rotation={[0, 0, rotation]}>
      <planeGeometry args={[scale * aspect, scale]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
};

const ModelItem: React.FC<{ src: string; scale: number; rotation: number }> = ({ src, scale, rotation }) => {
  const gltf = useLoader(GLTFLoader, src);
  return (
    <group rotation={[0, 0, rotation]} scale={scale}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <primitive object={gltf.scene} />
    </group>
  );
};

export const Scene: React.FC<MyCompSchemaType> = ({
  backgroundColor,
  assetType,
  assetSrc,
  spawnCount,
  seed,
  fallSpeed,
  itemScale,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();

  // Compute dynamic world-to-screen mapping
  const aspect = width / height;
  const halfHeight = 5; // matches camera setup and yStart
  const halfWidth = halfHeight * aspect; // visible half width at z=0
  const margin = Math.max(0.2, itemScale * 0.5); // keep a small margin to avoid clipping
  const xRange = Math.max(0, halfWidth - margin);

  // Update green screen color on container style
  const containerStyle = React.useMemo<React.CSSProperties>(() => ({
    backgroundColor,
  }), [backgroundColor]);

  // Precompute spawn info deterministically
  const spawns = useMemo(() => {
    const rng = makeRng(seed);
    const result: { spawnFrame: number; x: number; rotSpeed: number; drift: number }[] = [];
    for (let i = 0; i < spawnCount; i++) {
      const t = i / spawnCount; // spread roughly across timeline
      // jitter around the timeline
      const jitter = (rng() - 0.5) * 0.3; // +/-0.15
      const spawnFrame = Math.max(0, Math.min(durationInFrames - 1, Math.floor((t + jitter) * durationInFrames)));
      const x = (rng() * 2 - 1) * xRange; // cover full width
      const rotSpeed = (rng() * 2 - 1) * Math.PI; // +/- 180deg per second (applied scaled below)
      const drift = (rng() * 2 - 1) * 0.2; // small horizontal drift per second
      result.push({ spawnFrame, x, rotSpeed, drift });
    }
    // Ensure consistent ordering for deterministic mapping
    return result.sort((a, b) => a.spawnFrame - b.spawnFrame);
  }, [durationInFrames, seed, spawnCount, xRange]);

  // World bounds and motion params (in arbitrary Three units)
  const yStart = 5;
  const yEnd = -5.5; // despawn when below

  return (
    <AbsoluteFill style={containerStyle}>
      <ThreeCanvas linear width={width} height={height}>
        <SceneSetup />
        {/* Simple lighting for models */}
        <ambientLight intensity={1.2} color={0xffffff} />
        <directionalLight position={[3, 5, 2]} intensity={0.6} />

        {spawns.map((s, idx) => {
          const dtFrames = frame - s.spawnFrame;
          if (dtFrames < 0) return null; // not yet spawned
          const tSec = dtFrames / fps;
          const y = yStart - fallSpeed * tSec * 2.5; // scale speed to world units
          if (y < yEnd) return null; // off-screen
          let x = s.x + s.drift * tSec;
          x = Math.max(-xRange, Math.min(xRange, x));
          const rotation = s.rotSpeed * tSec * 0.5;

          return (
            <group key={idx} position={[x, y, 0]}>
              {assetType === "image" ? (
                <ImageItem src={assetSrc} scale={itemScale} rotation={rotation} />
              ) : (
                <ModelItem src={assetSrc} scale={itemScale} rotation={rotation} />
              )}
            </group>
          );
        })}
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
