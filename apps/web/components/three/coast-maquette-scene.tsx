"use client"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { AdaptiveDpr, ContactShadows, RoundedBox } from "@react-three/drei"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"

/**
 * CoastMaquette — the WebGL scene itself.                  Owner: W1-D
 *
 * NEVER IMPORT THIS DIRECTLY. `coast-maquette.tsx` is the entry point; it
 * owns the intersection observer, the WebGL probe and the poster fallback,
 * and it `dynamic()`-imports this module so three/drei stay out of the
 * landing route's initial JS. Importing it directly puts ~150KB on the
 * critical path and breaks the LCP budget.
 *
 * Modelled on NLP's `TowerMaquette.tsx`, with the guards that file does not
 * have. Verified against the reference: it has no WebGL probe, no off-screen
 * rAF pause, and no disposal — its `frameloop` is driven by reduced motion
 * alone, so once mounted it renders `always` for the life of the route
 * whether or not it is on screen. All three are required here (W1-D §4).
 *
 * An abstract massing model, not a photoreal render: seven residence blocks,
 * the taller hotel, a sea plane, a sun. A confident abstraction reads better
 * than a bad render and loads in a fraction of the bytes — and it cannot
 * misrepresent a building nobody has photographed from that angle.
 */

const BLOCK_COUNT = 7

/** x, z, height, width. Laid out as an arc facing the sea, not a grid. */
interface BlockDef {
  x: number
  z: number
  h: number
  w: number
  hotel?: boolean
}

const BLOCKS: readonly BlockDef[] = [
  { x: -3.1, z: 0.5, h: 1.5, w: 0.62 },
  { x: -2.1, z: 0.1, h: 1.9, w: 0.62 },
  { x: -1.05, z: -0.15, h: 1.65, w: 0.62 },
  { x: 0, z: -0.3, h: 2.6, w: 0.8, hotel: true },
  { x: 1.05, z: -0.15, h: 1.75, w: 0.62 },
  { x: 2.1, z: 0.1, h: 2.05, w: 0.62 },
  { x: 3.1, z: 0.5, h: 1.55, w: 0.62 },
  { x: -1.6, z: 1.5, h: 1.2, w: 0.5 },
]

function Block({ def, reduced }: { def: BlockDef; reduced: boolean }) {
  const y = def.h / 2 - 0.6
  return (
    <RoundedBox
      args={[def.w, def.h, def.w]}
      radius={0.045}
      smoothness={2}
      position={[def.x, y, def.z]}
    >
      <meshStandardMaterial
        color={def.hotel === true ? "#e8a24e" : "#4fc9e8"}
        metalness={0.15}
        roughness={0.42}
        emissive={def.hotel === true ? "#e8a24e" : "#0b5e7d"}
        emissiveIntensity={reduced ? 0.08 : 0.16}
      />
    </RoundedBox>
  )
}

function Sea() {
  return (
    <mesh position={[0, -0.62, 3.6]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[26, 12]} />
      <meshStandardMaterial
        color="#0b5e7d"
        metalness={0.6}
        roughness={0.25}
        transparent
        opacity={0.62}
      />
    </mesh>
  )
}

function Cluster({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    const g = group.current
    if (g === null || reduced) return
    // Clamped so a tab that was backgrounded for a minute does not resume with
    // one enormous delta and spin the model through half a turn.
    const d = Math.min(delta, 0.05)
    g.rotation.y += d * 0.08
  })

  return (
    <group ref={group}>
      {BLOCKS.map((def, index) => (
        <Block key={index} def={def} reduced={reduced} />
      ))}
      <Sea />
      {/* Plinth. */}
      <mesh position={[0, -0.62, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[5.2, 48]} />
        <meshStandardMaterial
          color="#04101a"
          metalness={0.7}
          roughness={0.45}
        />
      </mesh>
    </group>
  )
}

/**
 * Pauses the render loop whenever the tab is hidden.
 *
 * The NLP reference does not do this: its canvas renders `always` forever. On
 * a laptop that is a measurable battery drain for a scene nobody is looking
 * at, and W3-I lists it as a required behaviour. `frameloop` is flipped
 * imperatively through the R3F store rather than by re-rendering `<Canvas>`,
 * because changing the prop remounts the renderer and loses the GL context.
 */
function VisibilityPause({ reduced }: { reduced: boolean }) {
  const setFrameloop = useThree((state) => state.setFrameloop)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const apply = () => {
      if (document.hidden || reduced) {
        setFrameloop("demand")
        // One frame on demand, so a scene paused before it ever drew is not
        // left as an empty canvas.
        invalidate()
      } else {
        setFrameloop("always")
      }
    }

    apply()
    document.addEventListener("visibilitychange", apply)
    return () => document.removeEventListener("visibilitychange", apply)
  }, [reduced, setFrameloop, invalidate])

  return null
}

/**
 * Disposes every geometry, material and texture the scene allocated.
 *
 * R3F disposes what it created declaratively, but the renderer's own GL
 * context, programs and render targets are not covered, and a browser caps
 * live WebGL contexts at roughly sixteen. Navigating between routes that each
 * mount a canvas exhausts that budget and the seventeenth silently fails to
 * render — the "3D stops working after a few navigations" bug. The reference
 * has no `.dispose()` call anywhere.
 */
function DisposeOnUnmount() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    return () => {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose()
          const material: unknown = object.material
          if (Array.isArray(material)) {
            for (const entry of material) {
              ;(entry as THREE.Material).dispose()
            }
          } else if (material instanceof THREE.Material) {
            material.dispose()
          }
        }
      })
      gl.dispose()
      gl.forceContextLoss()
    }
  }, [gl, scene])

  return null
}

export default function CoastMaquetteScene({
  reduced = false,
}: {
  reduced?: boolean
}) {
  // Stable object identity so `<Canvas>` does not see a new prop every render.
  const glConfig = useMemo(
    () => ({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance" as const,
      // The scene is decorative; losing it is not worth a page reload.
      failIfMajorPerformanceCaveat: false,
    }),
    []
  )

  return (
    <Canvas
      // Never above 2. Uncapped DPR on a 3x phone renders nine times the
      // pixels for a difference nobody can see, and melts the GPU doing it.
      dpr={[1, 2]}
      performance={{ min: 0.5 }}
      gl={glConfig}
      camera={{ position: [0, 2.4, 9.5], fov: 30 }}
      frameloop={reduced ? "demand" : "always"}
    >
      <AdaptiveDpr pixelated />
      <VisibilityPause reduced={reduced} />
      <DisposeOnUnmount />

      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 8, 5]} intensity={1.15} />
      <directionalLight
        position={[-6, 3, -4]}
        intensity={0.35}
        color="#4fc9e8"
      />

      <Cluster reduced={reduced} />

      {/* Baked once. A static bake is imperceptible here and removes a full
          shadow pass every frame. */}
      <ContactShadows
        position={[0, -0.6, 0]}
        opacity={0.42}
        scale={14}
        blur={2.4}
        far={4}
        resolution={128}
        frames={1}
        color="#04101a"
      />
    </Canvas>
  )
}

export { BLOCK_COUNT }
