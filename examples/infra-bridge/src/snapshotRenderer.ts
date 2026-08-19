import type { ShapeMesh } from 'brepjs';

type Vector3 = readonly [number, number, number];
type Point2 = readonly [number, number];

export interface SnapshotEntry {
  readonly mesh: ShapeMesh;
  readonly color: string;
  readonly opacity?: number | undefined;
  readonly stroke?: string | undefined;
}

export interface SnapshotView {
  readonly key: 'isometric' | 'plan' | 'elevation';
  readonly name: string;
  readonly right: Vector3;
  readonly up: Vector3;
}

export interface SnapshotCamera {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export const SNAPSHOT_VIEWS: readonly SnapshotView[] = [
  {
    key: 'isometric',
    name: 'Isometric',
    right: [0.7071, -0.7071, 0],
    up: [-0.4082, -0.4082, 0.8165],
  },
  { key: 'plan', name: 'Plan', right: [1, 0, 0], up: [0, 1, 0] },
  { key: 'elevation', name: 'Elevation', right: [1, 0, 0], up: [0, 0, 1] },
];

interface ProjectedTriangle {
  readonly points: readonly [Point2, Point2, Point2];
  readonly depth: number;
  readonly color: string;
  readonly opacity: number;
  readonly stroke: string;
}

/** Compute projected bounds shared by every matched-camera render lane. */
export function createSnapshotCamera(
  entries: readonly SnapshotEntry[],
  view: SnapshotView
): SnapshotCamera {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const { mesh } of entries) {
    for (let index = 0; index + 2 < mesh.vertices.length; index += 3) {
      const x = mesh.vertices[index];
      const y = mesh.vertices[index + 1];
      const z = mesh.vertices[index + 2];
      if (x === undefined || y === undefined || z === undefined) continue;
      const [projectedX, projectedY] = project([x, y, z], view.right, view.up);
      xMin = Math.min(xMin, projectedX);
      xMax = Math.max(xMax, projectedX);
      yMin = Math.min(yMin, projectedY);
      yMax = Math.max(yMax, projectedY);
    }
  }
  if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
    throw new Error(`Cannot frame an empty ${view.name} snapshot`);
  }
  return { xMin, xMax, yMin, yMax };
}

/** Render one standalone SVG using an optional externally matched camera. */
export function renderSnapshot(
  entries: readonly SnapshotEntry[],
  title: string,
  view: SnapshotView,
  camera = createSnapshotCamera(entries, view)
): string {
  const width = 1_600;
  const height = 1_000;
  return svgDocument(
    width,
    height,
    renderPanel(entries, title, view, camera, { x: 0, width, height })
  );
}

/** Render Reference, authored output, and overlay panels through one shared camera. */
export function renderMatchedComparison(
  reference: readonly SnapshotEntry[],
  output: readonly SnapshotEntry[],
  view: SnapshotView
): { readonly svg: string; readonly camera: SnapshotCamera } {
  const camera = createSnapshotCamera([...reference, ...output], view);
  const panelWidth = 800;
  const height = 560;
  const overlay = [
    ...reference.map((entry) => ({
      ...entry,
      color: '#db2777',
      opacity: 0.34,
      stroke: '#9d174d',
    })),
    ...output.map((entry) => ({
      ...entry,
      color: '#0891b2',
      opacity: 0.34,
      stroke: '#155e75',
    })),
  ];
  const panels = [
    renderPanel(reference, `Reference · ${view.name}`, view, camera, {
      x: 0,
      width: panelWidth,
      height,
    }),
    renderPanel(output, `Authored output · ${view.name}`, view, camera, {
      x: panelWidth,
      width: panelWidth,
      height,
    }),
    renderPanel(overlay, `Overlay · ${view.name}`, view, camera, {
      x: panelWidth * 2,
      width: panelWidth,
      height,
    }),
  ].join('');
  return { svg: svgDocument(panelWidth * 3, height, panels), camera };
}

interface PanelLayout {
  readonly x: number;
  readonly width: number;
  readonly height: number;
}

function renderPanel(
  entries: readonly SnapshotEntry[],
  title: string,
  view: SnapshotView,
  camera: SnapshotCamera,
  layout: PanelLayout
): string {
  const triangles = projectTriangles(entries, view);
  const horizontalMargin = 40;
  const headerHeight = 76;
  const bottomMargin = 32;
  const spanX = Math.max(camera.xMax - camera.xMin, Number.EPSILON);
  const spanY = Math.max(camera.yMax - camera.yMin, Number.EPSILON);
  const scale = Math.min(
    (layout.width - horizontalMargin * 2) / spanX,
    (layout.height - headerHeight - bottomMargin) / spanY
  );
  const offsetX = layout.x + (layout.width - spanX * scale) / 2 - camera.xMin * scale;
  const offsetY = headerHeight + camera.yMax * scale;
  const polygons = triangles
    .map(({ points, color, opacity, stroke }) => {
      const coordinates = points
        .map(([x, y]) => `${(x * scale + offsetX).toFixed(2)},${(offsetY - y * scale).toFixed(2)}`)
        .join(' ');
      return `<polygon points="${coordinates}" fill="${color}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="0.32"/>`;
    })
    .join('');
  return `<g><rect x="${layout.x}" width="${layout.width}" height="${layout.height}" fill="#eef3f7"/><g>${polygons}</g><rect x="${layout.x + 20}" y="18" width="350" height="44" rx="8" fill="#ffffff" fill-opacity="0.9"/><text x="${layout.x + 36}" y="47" font-family="system-ui,sans-serif" font-size="20" fill="#17212b">${title}</text><line x1="${layout.x + layout.width}" x2="${layout.x + layout.width}" y2="${layout.height}" stroke="#cbd5e1"/></g>`;
}

function projectTriangles(
  entries: readonly SnapshotEntry[],
  view: SnapshotView
): readonly ProjectedTriangle[] {
  const depthAxis = cross(view.right, view.up);
  const light = normalized([-0.3, -0.4, 1]);
  const triangles: ProjectedTriangle[] = [];
  for (const entry of entries) {
    for (let index = 0; index < entry.mesh.triangles.length; index += 3) {
      const a = meshPoint(entry.mesh, entry.mesh.triangles[index]);
      const b = meshPoint(entry.mesh, entry.mesh.triangles[index + 1]);
      const c = meshPoint(entry.mesh, entry.mesh.triangles[index + 2]);
      if (a === undefined || b === undefined || c === undefined) continue;
      const normal = normalized(cross(subtract(b, a), subtract(c, a)));
      const shade = 0.58 + 0.42 * Math.abs(dot(normal, light));
      triangles.push({
        points: [
          project(a, view.right, view.up),
          project(b, view.right, view.up),
          project(c, view.right, view.up),
        ],
        depth: (dot(a, depthAxis) + dot(b, depthAxis) + dot(c, depthAxis)) / 3,
        color: shadeColor(entry.color, shade),
        opacity: entry.opacity ?? 1,
        stroke: entry.stroke ?? '#152231',
      });
    }
  }
  triangles.sort((left, right) => left.depth - right.depth);
  return triangles;
}

function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;
}

function meshPoint(mesh: ShapeMesh, vertexIndex: number | undefined): Vector3 | undefined {
  if (vertexIndex === undefined) return undefined;
  const offset = vertexIndex * 3;
  const x = mesh.vertices[offset];
  const y = mesh.vertices[offset + 1];
  const z = mesh.vertices[offset + 2];
  return x === undefined || y === undefined || z === undefined ? undefined : [x, y, z];
}

function project(point: Vector3, right: Vector3, up: Vector3): Point2 {
  return [dot(point, right), dot(point, up)];
}

function shadeColor(hex: string, shade: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 0xff) * shade);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalized(vector: Vector3): Vector3 {
  const length = Math.hypot(...vector);
  return length === 0 ? [0, 0, 1] : [vector[0] / length, vector[1] / length, vector[2] / length];
}
