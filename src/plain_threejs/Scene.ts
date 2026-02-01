/* MD

### 🌎 Creating our 3D world
---

In this tutorial you'll learn how to create a simple scene using `@thatopen/components`.

:::tip Hello world!

A world represents a 3D environment in your application. It consists of a scene, a camera and (optionally) a renderer. You can create multiple worlds and show them in multiple viewports at the same time.

:::

In this tutorial, we will import:

- `Three.js` to get some 3D entities for our app.
- `@thatopen/components` to set up the barebone of our app.
- `@thatopen/ui` to add some simple and cool UI menus.
- `Stats.js` (optional) to measure the performance of our app.

*/

import * as THREE from "three";
// import Stats from "stats.js";
import * as BUI from "@thatopen/ui";
// You have to import * as OBC from "@thatopen/components"
import * as OBC from '@thatopen/components';


/* MD
  ### 🖼️ Getting the container
  ---

  Next, we need to tell the library where do we want to render the 3D scene. We have added an DIV  element to this HTML page that occupies the whole width and height of the viewport. Let's fetch it by its ID:
*/

const container = document.getElementById("container")!;


const components = new OBC.Components();

const worlds = components.get(OBC.Worlds);

const world = worlds.create<
    OBC.SimpleScene,
    OBC.SimpleCamera,
    OBC.SimpleRenderer
>();

world.scene = new OBC.SimpleScene(components);
world.renderer = new OBC.SimpleRenderer(components, container);
world.camera = new OBC.SimpleCamera(components);

components.init();


world.scene.setup();

world.scene.three.background = null;


const githubUrl =
    "https://thatopen.github.io/engine_fragment/resources/worker.mjs";
const fetchedUrl = await fetch(githubUrl);
const workerBlob = await fetchedUrl.blob();
const workerFile = new File([workerBlob], "worker.mjs", {
    type: "text/javascript",
});
const workerUrl = URL.createObjectURL(workerFile);
const fragments = components.get(OBC.FragmentsManager);

fragments.init(workerUrl);

world.camera.controls.addEventListener("update", () => fragments.core.update());

// Remove z fighting
fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
    if (!("isLodMaterial" in material && material.isLodMaterial)) {
        material.polygonOffset = true;
        material.polygonOffsetUnits = 1;
        material.polygonOffsetFactor = Math.random();
    }
});

fragments.list.onItemSet.add(({ value: model }) => {
    model.useCamera(world.camera.three);
    world.scene.three.add(model.object);
    fragments.core.update(true);
});

const fragPaths = [
    "https://thatopen.github.io/engine_components/resources/frags/school_arq.frag",
];
await Promise.all(
    fragPaths.map(async (path) => {
        const modelId = path.split("/").pop()?.split(".").shift();
        if (!modelId) return null;
        const file = await fetch(path);
        const buffer = await file.arrayBuffer();
        return fragments.core.load(buffer, { modelId });
    }),
);

await world.camera.controls.setLookAt(68, 23, -8.5, 21.5, -5.5, 23);
await fragments.core.update(true);


BUI.Manager.init();

const panel = BUI.Component.create<BUI.PanelSection>(() => {
    return BUI.html`
      <bim-panel label="Worlds Tutorial" class="options-menu">
        <bim-panel-section label="Controls">
        
          <bim-color-input 
            label="Background Color" color="#202932" 
            @input="${({ target }: { target: BUI.ColorInput }) => {
              world.scene.config.backgroundColor = new THREE.Color(target.color);
            }}">
          </bim-color-input>
          
          <bim-number-input 
            slider step="0.1" label="Directional lights intensity" value="1.5" min="0.1" max="10"
            @change="${({ target }: { target: BUI.NumberInput }) => {
              world.scene.config.directionalLight.intensity = target.value;
            }}">
          </bim-number-input>
          
          <bim-number-input 
            slider step="0.1" label="Ambient light intensity" value="1" min="0.1" max="5"
            @change="${({ target }: { target: BUI.NumberInput }) => {
              world.scene.config.ambientLight.intensity = target.value;
            }}">
          </bim-number-input>
          
        </bim-panel-section>
      </bim-panel>
      `;
  });
  
  document.body.append(panel);

  const button = BUI.Component.create<BUI.PanelSection>(() => {
    return BUI.html`
        <bim-button class="phone-menu-toggler" icon="solar:settings-bold"
          @click="${() => {
            if (panel.classList.contains("options-menu-visible")) {
              panel.classList.remove("options-menu-visible");
            } else {
              panel.classList.add("options-menu-visible");
            }
          }}">
        </bim-button>
      `;
  });
  
  document.body.append(button);