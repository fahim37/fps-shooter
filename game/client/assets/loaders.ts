import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { assetUrl } from "./url";

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const gltfCache = new Map<string, Promise<GLTF>>();

export function loadGLTF(url: string): Promise<GLTF> {
  let p = gltfCache.get(url);
  if (!p) {
    p = gltfLoader.loadAsync(assetUrl(url));
    gltfCache.set(url, p);
  }
  return p;
}

const binCache = new Map<string, Promise<ArrayBuffer>>();

export function loadBinary(url: string): Promise<ArrayBuffer> {
  let p = binCache.get(url);
  if (!p) {
    p = fetch(assetUrl(url)).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    binCache.set(url, p);
  }
  return p;
}

const textureLoader = new THREE.TextureLoader();
const texCache = new Map<string, Promise<THREE.Texture>>();

export function loadTexture(url: string, srgb = true): Promise<THREE.Texture> {
  let p = texCache.get(url);
  if (!p) {
    p = textureLoader.loadAsync(assetUrl(url)).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return t;
    });
    texCache.set(url, p);
  }
  return p;
}
