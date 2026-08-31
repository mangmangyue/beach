/* 场景装配的小工具（窗口 A）。各物件 viewer 里反复出现的那几招集中放这儿。 */
import * as THREE from 'three';
import { ENV } from '../constitution.js';

/* 确定性伪随机：同一个 seed 每次撒出来一样 */
export function rng(seed) {
  let x = seed * 9301 + 49297;
  const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  r.gauss = () => (r() + r() + r() - 1.5) * 1.15;
  r.range = (a, b) => a + (b - a) * r();
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  return r;
}

/* 顶点色 alpha 当"薄度"的边缘透光（贝壳 / 花 viewer 的同一招）。
 * 强度跟宪法全局 ENV.rimS × 花瓣档走，每帧 refreshRim() 同步。 */
export const rimUniforms = { uRimS: { value: 0.1 }, uRimP: { value: 1.6 }, uRimC: { value: new THREE.Color('#FFFFFF') } };
export function refreshRim() {
  rimUniforms.uRimS.value = ENV.rimS / 100 * ENV.rimPetal / 100;
  rimUniforms.uRimP.value = ENV.rimP / 100;
}
export function addRim(m) {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, rimUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vThin; varying vec3 vWN; varying vec3 vWP;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvThin = color.a; vWN = normalize(mat3(modelMatrix) * normal); vWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRimS, uRimP; uniform vec3 uRimC; varying float vThin; varying vec3 vWN; varying vec3 vWP;')
      .replace('#include <dithering_fragment>',
        `{ vec3 n = normalize(vWN); vec3 v = normalize(cameraPosition - vWP);
           float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), uRimP);
           gl_FragColor.rgb = min(gl_FragColor.rgb + uRimC * diffuseColor.rgb * f * vThin * uRimS, vec3(1.0)); }
         #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'shellRim';
  return m;
}

/* glb 贴图：raw（不过调色），flipY=false */
export function loadTexRaw(path, onLoad) {
  const t = new THREE.TextureLoader().load(path, onLoad);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function loadGLB(url) {
  return import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) =>
    new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej)));
}

/* 软接触阴影片（垫子上的物件用；沙上的由 stage.sink 负责） */
export function blobShadow(stage, cx, y, cz, size, opacity = 0.28) {
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: stage.blobTex, color: '#5A6672', transparent: true, opacity, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2;
  sh.position.set(cx, y, cz);
  sh.scale.set(size, size, 1);
  sh.userData.noSink = true; sh.userData.noBounds = true;
  return sh;
}

/* 物件的包围盒（跳过 noBounds 的辅助件） */
export function bbox(obj) {
  obj.updateWorldMatrix(true, true);
  const b = new THREE.Box3(), tmp = new THREE.Box3();
  obj.traverse(o => {
    if (!o.isMesh || o.userData.noBounds || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    b.union(tmp);
  });
  return b;
}
