"use client"

import { useRef, useEffect } from "react";
import { Renderer, Program, Mesh, Triangle, Vec2 } from "ogl";

const vertex = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `
#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;

// Smooth noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

// Fractal Brownian Motion for organic flow
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;

    // Base purple background color
    vec3 bgDark = vec3(0.05, 0.02, 0.12);
    vec3 bgMid  = vec3(0.12, 0.04, 0.22);

    // Aurora colors - soft purples only
    vec3 purple1 = vec3(0.20, 0.06, 0.40);  // deep purple
    vec3 purple2 = vec3(0.35, 0.12, 0.60);  // medium purple
    vec3 purple3 = vec3(0.50, 0.25, 0.75);  // bright purple
    vec3 purple4 = vec3(0.40, 0.18, 0.55);  // warm purple

    // Slow time
    float t = uTime * 0.08;

    // Create flowing distortion fields
    float f1 = fbm(uv * 2.0 + vec2(t, t * 0.7));
    float f2 = fbm(uv * 2.5 + vec2(-t * 0.6, t * 0.4) + f1 * 0.5);
    float f3 = fbm(uv * 1.8 + vec2(t * 0.3, -t * 0.5) + f2 * 0.3);

    // Blend aurora bands
    float band1 = smoothstep(0.3, 0.7, f1);
    float band2 = smoothstep(0.35, 0.65, f2);
    float band3 = smoothstep(0.4, 0.6, f3);

    // Start with dark background gradient
    vec3 col = mix(bgDark, bgMid, uv.y * 0.8 + f1 * 0.2);

    // Layer the purple aurora bands
    col = mix(col, purple1, band1 * 0.5);
    col = mix(col, purple2, band2 * 0.35);
    col = mix(col, purple3, band3 * 0.2);
    col = mix(col, purple4, (band1 * band2) * 0.25);

    // Subtle bright accent in flowing areas
    float highlight = smoothstep(0.55, 0.8, f1 * f2 + f3 * 0.3);
    col += purple3 * highlight * 0.15;

    // Gentle vignette
    vec2 vig = uv - 0.5;
    float vigAmount = 1.0 - dot(vig, vig) * 0.5;
    col *= vigAmount;

    gl_FragColor = vec4(col, 1.0);
}
`;

type Props = {
  resolutionScale?: number;
};

export default function AuroraFlow({ resolutionScale = 1.0 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current as HTMLCanvasElement;
    const parent = canvas.parentElement as HTMLElement;

    const renderer = new Renderer({
      dpr: Math.min(window.devicePixelRatio, 2),
      canvas,
    });

    const gl = renderer.gl;
    gl.clearColor(0.05, 0.02, 0.12, 1);
    const geometry = new Triangle(gl);

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2() },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      renderer.setSize(w * resolutionScale, h * resolutionScale);
      program.uniforms.uResolution.value.set(
        w * resolutionScale,
        h * resolutionScale
      );
    };

    window.addEventListener("resize", resize);
    resize();

    const start = performance.now();
    let frame = 0;

    const loop = () => {
      program.uniforms.uTime.value = (performance.now() - start) / 1000;
      renderer.render({ scene: mesh });
      frame = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [resolutionScale]);

  return <canvas ref={ref} className="w-full h-full block" />;
}
