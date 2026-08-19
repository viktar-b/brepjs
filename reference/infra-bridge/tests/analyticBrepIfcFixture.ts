import { createHash } from 'node:crypto';

export const ANALYTIC_BREP_GLOBAL_ID = '0123456789ABCDEFGHIJKL';

export interface SyntheticAnalyticBrepOptions {
  readonly topology?: 'closed' | 'open' | 'broken-loop' | 'non-rectangular';
  readonly bodyItem?: 'advanced-brep' | 'advanced-face';
  readonly surface?: 'planes' | 'cylinder';
  readonly mapped?: boolean;
}

type Point = readonly [number, number, number];
type Edge = readonly [number, number];

const POINTS: readonly Point[] = [
  [0, 0, 0],
  [2, 0, 0],
  [2, 3, 0],
  [0, 3, 0],
  [0, 0, 4],
  [2, 0, 4],
  [2, 3, 4],
  [0, 3, 4],
];

const EDGES: readonly Edge[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

interface FaceRecipe {
  readonly edges: readonly (readonly [number, boolean])[];
  readonly boundOrientation: boolean;
  readonly planePoint: number;
  readonly normal: Point;
  readonly xAxis: Point;
  readonly sameSense: boolean;
}

const FACES: readonly FaceRecipe[] = [
  {
    edges: [
      [0, true],
      [1, true],
      [2, true],
      [3, true],
    ],
    boundOrientation: false,
    planePoint: 0,
    normal: [0, 0, 1],
    xAxis: [1, 0, 0],
    sameSense: false,
  },
  {
    edges: [
      [4, true],
      [5, true],
      [6, true],
      [7, true],
    ],
    boundOrientation: true,
    planePoint: 4,
    normal: [0, 0, 1],
    xAxis: [1, 0, 0],
    sameSense: true,
  },
  {
    edges: [
      [0, true],
      [9, true],
      [4, false],
      [8, false],
    ],
    boundOrientation: true,
    planePoint: 0,
    normal: [0, -1, 0],
    xAxis: [1, 0, 0],
    sameSense: true,
  },
  {
    edges: [
      [1, true],
      [10, true],
      [5, false],
      [9, false],
    ],
    boundOrientation: true,
    planePoint: 1,
    normal: [1, 0, 0],
    xAxis: [0, 1, 0],
    sameSense: true,
  },
  {
    edges: [
      [2, true],
      [11, true],
      [6, false],
      [10, false],
    ],
    boundOrientation: true,
    planePoint: 2,
    normal: [0, 1, 0],
    xAxis: [-1, 0, 0],
    sameSense: true,
  },
  {
    edges: [
      [3, true],
      [8, true],
      [7, false],
      [11, false],
    ],
    boundOrientation: true,
    planePoint: 3,
    normal: [-1, 0, 0],
    xAxis: [0, -1, 0],
    sameSense: true,
  },
];

function tuple(value: Point): string {
  return `(${value.map((coordinate) => `${coordinate}.`).join(',')})`;
}

function bool(value: boolean): string {
  return value ? '.T.' : '.F.';
}

function edgeLines(): string[] {
  return EDGES.flatMap(([start, end], index) => {
    const base = 200 + index * 5;
    const a = POINTS[start];
    const b = POINTS[end];
    if (a === undefined || b === undefined) throw new Error('invalid synthetic edge fixture');
    const direction: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const magnitude = Math.hypot(...direction);
    const normalized: Point = [
      direction[0] / magnitude,
      direction[1] / magnitude,
      direction[2] / magnitude,
    ];
    const reverse = index === 0;
    const lineDirection: Point = reverse
      ? [-normalized[0], -normalized[1], -normalized[2]]
      : normalized;
    return [
      `#${base}=IFCDIRECTION(${tuple(lineDirection)});`,
      `#${base + 1}=IFCVECTOR(#${base},${magnitude}.);`,
      `#${base + 2}=IFCLINE(#${100 + (reverse ? end : start)},#${base + 1});`,
      `#${base + 3}=IFCEDGECURVE(#${110 + start},#${110 + end},#${base + 2},${bool(!reverse)});`,
    ];
  });
}

function faceLines(options: SyntheticAnalyticBrepOptions): string[] {
  return FACES.flatMap((face, faceIndex) => {
    const base = 400 + faceIndex * 20;
    const edges = face.edges.map(([edgeIndex, orientation], useIndex) => {
      const broken = options.topology === 'broken-loop' && faceIndex === 2 && useIndex === 1;
      return `#${base + useIndex}=IFCORIENTEDEDGE(*,*,#${200 + edgeIndex * 5 + 3},${bool(broken ? !orientation : orientation)});`;
    });
    const loopEdgeCount =
      options.topology === 'non-rectangular' && faceIndex === 0 ? 3 : face.edges.length;
    const loop = `#${base + 5}=IFCEDGELOOP((${face.edges
      .slice(0, loopEdgeCount)
      .map((_, useIndex) => `#${base + useIndex}`)
      .join(',')}));`;
    const bound = `#${base + 6}=IFCFACEOUTERBOUND(#${base + 5},${bool(face.boundOrientation)});`;
    const axis = `#${base + 10}=IFCDIRECTION(${tuple(face.normal)});`;
    const refDirection = `#${base + 11}=IFCDIRECTION(${tuple(face.xAxis)});`;
    const placement = `#${base + 7}=IFCAXIS2PLACEMENT3D(#${100 + face.planePoint},#${base + 10},#${base + 11});`;
    const surface =
      options.surface === 'cylinder' && faceIndex === 0
        ? `#${base + 8}=IFCCYLINDRICALSURFACE(#${base + 7},1.);`
        : `#${base + 8}=IFCPLANE(#${base + 7});`;
    const advancedFace = `#${base + 9}=IFCADVANCEDFACE((#${base + 6}),#${base + 8},${bool(face.sameSense)});`;
    return [...edges, loop, bound, axis, refDirection, placement, surface, advancedFace];
  });
}

export function syntheticAnalyticBrepIfc(options: SyntheticAnalyticBrepOptions = {}): Uint8Array {
  const pointLines = POINTS.flatMap((point, index) => [
    `#${100 + index}=IFCCARTESIANPOINT(${tuple(point)});`,
    `#${110 + index}=IFCVERTEXPOINT(#${100 + index});`,
  ]);
  const faceIds = FACES.map((_, index) => `#${400 + index * 20 + 9}`);
  const shellFaces = options.topology === 'open' ? faceIds.slice(0, -1) : faceIds;
  const completeBodyItem = options.bodyItem === 'advanced-face' ? faceIds[0] : '#22';
  const bodyItem = options.mapped === true ? '#25' : completeBodyItem;
  const source = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    "FILE_NAME('synthetic-advanced-brep.ifc','2026-08-19T00:00:00',('brepjs'),('brepjs'),'brepjs','brepjs','');",
    "FILE_SCHEMA(('IFC4X3_ADD2'));",
    'ENDSEC;',
    'DATA;',
    "#1=IFCPROJECT('2123456789ABCDEFGHIJKL',$,'Synthetic Analytic Project',$,$,$,$,(#2),#6);",
    "#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#3,$);",
    '#3=IFCAXIS2PLACEMENT3D(#4,$,$);',
    '#4=IFCCARTESIANPOINT((0.,0.,0.));',
    '#6=IFCUNITASSIGNMENT((#7));',
    '#7=IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.);',
    '#10=IFCLOCALPLACEMENT($,#11);',
    '#11=IFCAXIS2PLACEMENT3D(#12,#13,#14);',
    '#12=IFCCARTESIANPOINT((10.,20.,0.));',
    '#13=IFCDIRECTION((0.,0.,1.));',
    '#14=IFCDIRECTION((0.,1.,0.));',
    '#15=IFCLOCALPLACEMENT(#10,#16);',
    '#16=IFCAXIS2PLACEMENT3D(#17,$,$);',
    '#17=IFCCARTESIANPOINT((1.,0.,0.5));',
    '#20=IFCPRODUCTDEFINITIONSHAPE($,$,(#21));',
    `#21=IFCSHAPEREPRESENTATION(#2,'Body','AdvancedBrep',(${bodyItem}));`,
    '#22=IFCADVANCEDBREP(#23);',
    `#23=IFCCLOSEDSHELL((${shellFaces.join(',')}));`,
    ...(options.mapped === true
      ? [
          '#24=IFCCARTESIANTRANSFORMATIONOPERATOR3D(#26,#27,#28,1.,#29);',
          '#25=IFCMAPPEDITEM(#50,#24);',
          '#26=IFCDIRECTION((0.,1.,0.));',
          '#27=IFCDIRECTION((-1.,0.,0.));',
          '#28=IFCCARTESIANPOINT((0.,0.,0.));',
          '#29=IFCDIRECTION((0.,0.,1.));',
          `#50=IFCREPRESENTATIONMAP(#51,#52);`,
          '#51=IFCAXIS2PLACEMENT3D(#53,$,$);',
          `#52=IFCSHAPEREPRESENTATION(#2,'Body','AdvancedBrep',(${completeBodyItem}));`,
          '#53=IFCCARTESIANPOINT((0.,0.,0.));',
        ]
      : []),
    ...pointLines,
    ...edgeLines(),
    ...faceLines(options),
    `#800=IFCMEMBER('${ANALYTIC_BREP_GLOBAL_ID}',$,'Analytic Box',$,$,#15,#20,$,.MEMBER.);`,
    "#801=IFCMATERIAL('Analytic Steel',$,$);",
    "#802=IFCRELASSOCIATESMATERIAL('1123456789ABCDEFGHIJKL',$,$,$,(#800),#801);",
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');
  return new TextEncoder().encode(source);
}

export function analyticBrepSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
