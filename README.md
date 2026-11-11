# Avatar animation
### Controlled avatar behavior for interactive bargaining experiments

Developed for the **[Treasure Hunters](https://github.com/nicolasgonzalezr/treasure-hunters-bargaining-game)** bargaining game, this project generates concession schedules for a virtual opponent and animates 3D avatars using Three.js. The animation runs in a web worker launched from the oTree participant page and connects via WebSocket to a local backend performing real-time facial expression recognition (FER). This enables the virtual opponent to display facial responses contingent on the participant’s expressions.

## Preregistered technical specifications

The central references for this project are two **technical appendices**:

| Document | Contents |
| --- | --- |
| **[Avatar concession process](docs/Avatar_Behavior_Appendix_Bargaining.pdf)** | Stochastic concession timing, parameter calibration, sampling, filtering, and diagnostics for the generated schedules. |
| **[Avatar animation](docs/Avatar_Behavior_Appendix_Animation.pdf)** | Baseline and spontaneous smiles, contingent mimicry, latency, temporal smoothing, stochastic modulation, and recorded motion. |

These documents explain the design behind the implementation.

## See it in action

Both conditions include background motion and mild spontaneous smiling. An experimental condition additionally enables contingent responses to participants' smiling.

<table>
  <tr>
    <th>Smile control</th>
    <th>Smile treatment</th>
  </tr>
  <tr>
    <td width="50%">
      <video src="https://github.com/user-attachments/assets/5bfcc227-a54e-40de-b46e-f0c1b08a58bd" controls></video>
    </td>
    <td width="50%">
      <video src="https://github.com/user-attachments/assets/277340ba-d1f9-424e-85d8-78474841b4fe" controls></video>
    </td>
  </tr>
</table>

*Note.* The participant view was added to these demonstration videos to illustrate how the avatar responds to the player's facial expressions. This view is not shown to participants during the task.

## Part of a connected research platform

| Project | Responsibility |
| --- | --- |
| **[Treasure Hunters](https://github.com/nicolasgonzalezr/treasure-hunters-bargaining-game)** | Runs the oTree experiment, assigns conditions and schedules, executes the avatar's concessions, sends animation triggers, and records bargaining behavior. |
| **Avatar animation — this repository** | Generates bargaining schedules, prepares motion assets, renders avatars, and implements the facial-response rules. |
| **[Face inference](https://github.com/nicolasgonzalezr/face-inference)** | Controls cameras, supplies live facial-expression estimates, records facial signals and avatar state, and performs offline processing. |

Concession schedules are generated here and consumed by **oTree**. Recorded motion assets and live facial estimates are consumed by **the browser animation**. The oTree host supplies treatment assignment, session metadata, asset paths, and spontaneous-smile triggers.

## Generating the bargaining behavior

The avatar's concession timing follows a **non-homogeneous Poisson process (NHPP)** with a decreasing intensity:

$$
\lambda(t) = \theta + (Y_0 - \theta)e^{-\kappa t}.
$$

The rate follows the deterministic mean trajectory of an Ornstein–Uhlenbeck process. Randomness enters through the timing of concession events. Each event advances the bargaining slider by one discrete step.

The generator calibrates the initial rate to an expected 23 concessions over a 60-second window, with terminal-rate parameter $\theta = 0.2$ and decay parameter $\kappa = 0.075$. Candidate event times are sampled using Ogata thinning. An initial delay of 1.5–3 seconds is added, events beyond the deadline are removed, and schedules are filtered for temporal shape and a total of 21–25 concessions. The resulting stimuli are **delayed, filtered NHPP draws**.

The repository supplies **500 accepted schedules**. Their summaries match the bargaining appendix:

| Measure | Mean | SD | Range |
| --- | ---: | ---: | ---: |
| Total concessions | 22.76 | 1.37 | 21–25 |
| Time to the even split, seconds | 44.95 | 6.30 | 29.91–58.06 |

The oTree application selects and executes the schedules during bargaining rounds. Their generation is independent of participant behavior.

**Source:** [`RecordingProcessing/ConcessionGenerator.qmd`](RecordingProcessing/ConcessionGenerator.qmd). See the **[bargaining appendix](docs/Avatar_Behavior_Appendix_Bargaining.pdf)** for the derivation, acceptance criteria, and diagnostics.

## Generating the facial behavior

The avatar's displayed smile combines three components:

$$
S(t) = \max\{S_{\mathrm{base}}, S_{\mathrm{spont}}(t), S_{\mathrm{mimic}}(t)\}.
$$

**Baseline and spontaneous smiles.** A baseline intensity of 0.15 keeps the avatar mildly expressive. Triggered smiles follow a smooth rise–hold–fade profile with peak intensity drawn uniformly between 0.2 and 0.4. The preregistered design specifies seven spontaneous smiles across the 60-second bargaining window, using the same procedure across conditions. Trigger scheduling belongs to the oTree host; this repository implements the resulting expression.

**Contingent mimicry.** In the experimental condition, the incoming player smile estimate drives a smoothed, delayed smile response. The implementation combines fast and slow exponential moving averages and introduces stochastic variation in responsiveness and intensity. In the control condition, the incoming smile signal is ignored, while baseline and spontaneous expressions remain active.

| Component | Specification |
| --- | --- |
| Baseline smile intensity | 0.15 |
| Spontaneous-smile peak | Uniform between 0.2 and 0.4 |
| Central rise / hold / fade durations | 0.75 / 2 / 3 seconds |
| Implemented rise / hold / fade half-ranges | ±0.102 / ±0.306 / ±0.408 seconds |
| Fast / slow smoothing time constants | 0.65 / 3.5 seconds |
| Mimicry latency | 0.5 seconds |
| Responsiveness variation | Mean-reverting process centered on 1, bounded between 0.7 and 1.3 |
| Mimicry-intensity variation | Bounded random walk between 0.6 and 1 |
| Blink closing / hold / opening durations | 0.10 / 0.04 / 0.16 seconds |

*Implementation note.* Spontaneous-smile timing variation is 59.18% narrower than the preregistered ranges; mean durations are unchanged.

**Recorded motion.** Eye movements, head rotation, and blink timing are prepared from facial recordings and replayed continuously. The current design uses two motion schedules held fixed across participants. The R notebook applies circular Savitzky–Golay smoothing and exports eye channels, head quaternions, timestamps, and blink schedules as binary assets with a JSON channel header.

**Sources:** [`mainWorker.js`](mainWorker.js) and [`RecordingProcessing/RecordingProcessing.qmd`](RecordingProcessing/RecordingProcessing.qmd). See the **[animation appendix](docs/Avatar_Behavior_Appendix_Animation.pdf)** for the preregistered specification.

## Browser components and repository contents

| Path | Purpose |
| --- | --- |
| `mainWorker.js` | Experimental avatar rendering in a worker, motion playback, smile dynamics, and communication with FaceInferenceApp. |
| `mainTracking.js` | Webcam-driven avatar preview using MediaPipe blendshapes and head rotation. |
| `mainRecording.js` | Captures facial blendshapes and head rotation for motion preparation. |
| `mainStatic.js` | Static avatar display. |
| `RecordingProcessing/ConcessionGenerator.qmd` | Bargaining-schedule generator and diagnostics. |
| `RecordingProcessing/RecordingProcessing.qmd` | Recorded-motion preparation and binary export. |
| `RecordingProcessing/ConcessionSchedules.json` | Generated schedules consumed by oTree. |
| `RecordingProcessing/*.bin` and `EyeHeader.json` | Prepared motion assets and their channel order. |
| `models/` and `wasm/` | MediaPipe model and runtime resources. |
| `vite.config.js`, `package.json`, `package-lock.json` | Browser build configuration and JavaScript dependencies. |

## Build and integration

### Build the browser code

Use Node.js compatible with the locked Vite version; Node.js 22.12 or later satisfies its engine requirement. From the repository root:

```bash
npm ci
npx vite build
```

The current Vite configuration builds **`mainWorker.js`** into `dist/`. To build another browser component, select its source file through `build.rollupOptions.input` in `vite.config.js`.

### Connect to Treasure Hunters and FaceInferenceApp

Deploy the browser code and supporting assets to the locations expected by the oTree application:

| Source | Destination in Treasure Hunters |
| --- | --- |
| Browser build output | `_static/AvatarAnimation/assets/` |
| Motion `.bin` files and `EyeHeader.json` | `_static/AvatarAnimation/data/` |
| `models/` and `wasm/` | `_static/AvatarAnimation/models/` and `_static/AvatarAnimation/wasm/` |
| `RecordingProcessing/ConcessionSchedules.json` | `treasure_hunters/data/ConcessionSchedules.json` |

Match the deployed entry filenames to the host imports. For example, Treasure Hunters loads the worker as `AvatarWorker.js`; the default Vite-generated filename may need to be renamed or configured accordingly. Retain any accompanying generated chunks.

The host initializes the worker with an `OffscreenCanvas`, display dimensions, avatar-model and motion-data paths, treatment assignment, and session/round metadata. Compatible GLB models must provide the expected facial morph targets and `Head` bone. Avatar models are supplied through the host application.

FaceInferenceApp runs on each participant terminal at `localhost:8001/ws`. The worker receives the `Happy` estimate and sends back the displayed smile, smoothed mimicry, and spontaneous-smile values for logging. The oTree host sends spontaneous-smile triggers with `worker.postMessage({ trigger: true })`.

The browser requires WebGL and OffscreenCanvas support. Webcam tracking and recording also require camera access. See **[Treasure Hunters](https://github.com/nicolasgonzalezr/treasure-hunters-bargaining-game)** for the complete experimental setup.

### Regenerate the stimuli

The R notebooks require **R**, **Quarto**, and the `tidyverse`, `jsonlite`, and `signal` packages. From `RecordingProcessing/`:

```bash
quarto render ConcessionGenerator.qmd
quarto render RecordingProcessing.qmd
```

The motion-preparation notebook expects a facial-log CSV named in its input section. The source CSV is not included in this repository, you may supply compatible facial logs or request the original files by email. Prepared assets are supplied for running the existing experiment without regenerating them.

## License

Original code in this repository is licensed under the [MIT License](LICENSE).

Third-party software and model assets retain their respective licenses and attribution requirements, including:

- **[MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)** — Apache License 2.0.
- **[Three.js](https://github.com/mrdoob/three.js/blob/dev/LICENSE)** — MIT License.

## Contact

For questions about stimulus generation, animation behavior, or integration:

**Nicolás González-Raposo** — nicgonzalezr@udd.cl · [ORCID](https://orcid.org/0000-0002-2723-0354)
