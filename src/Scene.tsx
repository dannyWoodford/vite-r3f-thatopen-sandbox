import { OrbitControls, Stats } from '@react-three/drei'
import { useControls } from 'leva'
import { ThatOpenFragment } from './components/ThatOpenFragment'

function Scene() {
  const { performance } = useControls('Monitoring', {
    performance: true,
  })

  return (
    <>
      {performance && <Stats />}

      <OrbitControls makeDefault />

      <directionalLight
        position={[-2, 2, 3]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024 * 2, 1024 * 2]}
      />
      <ambientLight intensity={0.2} />

      <ThatOpenFragment />
    </>
  )
}

export { Scene }
