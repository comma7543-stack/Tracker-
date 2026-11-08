# Vista Bay: procedural open-world city map for Blender

`vista_bay_city.py` builds a whole coastal city in the style of an open-world game, using only code with no downloaded assets. It sets up procedural colored materials and Cycles 4K rendering (3840 x 2160).

The city is original. It is not a copy of any existing game map.

## What gets generated

| District | Contents |
|---|---|
| Downtown | Glass skyscrapers up to ~280 m. Includes setbacks, round towers, spires with warning lights, rooftop helipads, AC units and parapets. |
| Midtown | Brick/concrete mid-rises with procedural windows, cornices, rooftop water towers and parking lots with parked cars. |
| Beachfront | Pastel hotels with rooftop pools, a palm-lined promenade, sand beach, umbrellas, towels and lifeguard towers. |
| Suburbs | Houses with gable roofs, garages, driveways, backyard pools, trees and palms. |
| Industrial / Port | Warehouses with roller doors and skylights, container yards, 4 gantry cranes, and a cargo ship loaded with containers. |
| Freeway | Elevated ring road with pillars, lane markings, barriers, lamps and traffic. A spur ramps down to the airport. |
| Airport | Runway with markings and edge lights, taxiways, terminal, jet bridges, 6 airliners, control tower, hangars. |
| Landmarks | Pier with stalls, ferris wheel (neon at night) and coaster track; a stadium with floodlights; a park with a lake and gazebo. |
| Hills | Noise-generated mountains with rock/brush coloring, ~80 hillside mansions with pools, thousands of trees and bushes, radio towers. |
| Streets | Asphalt, sidewalks with curbs, dashed center lines, crosswalks, stop lines, streetlights, ~1,500 cars/buses (right-hand traffic). |

There are 3 lighting modes: `SUNSET` (golden hour, the default), `DAY`, and `NIGHT`. At night the windows, street lamps (real light pools), headlights and neon light up.

There are 4 cameras:
- `Cam_Aerial`: hero shot from over the ocean
- `Cam_Map`: orthographic top-down, the game-map view. Use `DAY` for this one.
- `Cam_Street`: street level in downtown
- `Cam_Beach`: beach and pier

## How to run

### Inside Blender (4.2+, tested on 5.0.1)
1. Open Blender and switch to the **Scripting** tab.
2. Click **Open** and select `vista_bay_city.py`, then click **Run Script**. Generation takes roughly 5-60 seconds depending on the PC. **This wipes the current scene.**
3. In the Outliner, pick a camera, then press `Ctrl+Numpad 0` to make it active.
4. Press **F12** to render.

To change the time of day, resolution or samples, edit the `CONFIG` block at the top of the script.

### From a terminal (no UI)
```bash
# all cameras, 4K, sunset
blender -b -P vista_bay_city.py -- --render

# top-down map in daylight
blender -b -P vista_bay_city.py -- --time DAY --render --cams Cam_Map

# night aerial, saved as JPEG
blender -b -P vista_bay_city.py -- --time NIGHT --render --cams Cam_Aerial --jpg

# just save the .blend to open later
blender -b -P vista_bay_city.py -- --save vista_bay.blend
```

| Option | Meaning |
|---|---|
| `--render` | render to `./renders/` |
| `--cams A,B` | which cameras to render |
| `--time DAY\|SUNSET\|NIGHT` | lighting |
| `--samples N` | Cycles samples (default 256) |
| `--res WxH` | resolution (default 3840x2160) |
| `--detail 0.3..1.0` | fewer trees/cars/props for weak PCs |
| `--no-haze` | turn off atmospheric haze (faster) |
| `--jpg` | save JPEG instead of PNG |
| `--out DIR` | output folder |
| `--save FILE.blend` | save the scene |

## Render times (measured)

Tested on a 4-core cloud CPU with no GPU:
- 960x540 at 16 samples: about 20-30 s per camera
- 4K at 64 samples: several minutes per camera (see the preview images)

On an NVIDIA/AMD/Apple GPU the script picks the GPU automatically (OptiX > CUDA > HIP > Metal > oneAPI) and is many times faster. For the final 4K image use 256 samples, which is the default. Denoising is on.

## Scene stats
- About 1.1 million vertices of city geometry, plus terrain
- Geometry is batched into one object per material, which keeps the viewport usable
- Every material is procedural (node-based). Building windows come from a brick-pattern trick in world space, and the lit windows are randomized per building.

## Preview renders
See `previews/`.
