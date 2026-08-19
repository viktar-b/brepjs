import { createHash } from 'node:crypto';

export const PARAMETRIC_MEMBER_GLOBAL_ID = '3123456789ABCDEFGHIJKL';

export interface SyntheticParametricIfcOptions {
  readonly depth?: 'positive' | 'zero';
  readonly direction?: 'valid' | 'in-profile-plane';
  readonly placement?: 'valid' | 'invalid-solid';
  readonly profile?: 'rectangle' | 'circle';
}

export function syntheticParametricIfc(options: SyntheticParametricIfcOptions = {}): Uint8Array {
  const profile =
    options.profile === 'circle'
      ? "IFCCIRCLEPROFILEDEF(.AREA.,'Unsupported Circle',#24,1.)"
      : "IFCRECTANGLEPROFILEDEF(.AREA.,'Offset Rectangle',#24,2.,1.)";
  const depth = options.depth === 'zero' ? '0.' : '2.5';
  const direction = options.direction === 'in-profile-plane' ? '(1.,0.,0.)' : '(0.,0.,-1.)';
  const solidPlacement = options.placement === 'invalid-solid' ? '#24' : '#27';
  const source = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME('synthetic-parametric.ifc','2026-08-19T00:00:00',('brepjs'),('brepjs'),'brepjs','brepjs','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1=IFCPROJECT('2123456789ABCDEFGHIJKL',$,'Synthetic Parametric Project',$,$,$,$,(#2),#6);
#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#3,$);
#3=IFCAXIS2PLACEMENT3D(#4,$,$);
#4=IFCCARTESIANPOINT((0.,0.,0.));
#6=IFCUNITASSIGNMENT((#7));
#7=IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.);
#10=IFCLOCALPLACEMENT($,#11);
#11=IFCAXIS2PLACEMENT3D(#12,#13,#14);
#12=IFCCARTESIANPOINT((10.,20.,0.));
#13=IFCDIRECTION((0.,0.,1.));
#14=IFCDIRECTION((0.,1.,0.));
#15=IFCLOCALPLACEMENT(#10,#16);
#16=IFCAXIS2PLACEMENT3D(#17,$,$);
#17=IFCCARTESIANPOINT((1.,0.,0.5));
#20=IFCPRODUCTDEFINITIONSHAPE($,$,(#21));
#21=IFCSHAPEREPRESENTATION(#2,'Body','SweptSolid',(#22));
#22=IFCEXTRUDEDAREASOLID(#23,${solidPlacement},#31,${depth});
#23=${profile};
#24=IFCAXIS2PLACEMENT2D(#25,#26);
#25=IFCCARTESIANPOINT((1.,2.));
#26=IFCDIRECTION((0.,1.));
#27=IFCAXIS2PLACEMENT3D(#28,#29,#30);
#28=IFCCARTESIANPOINT((3.,4.,5.));
#29=IFCDIRECTION((0.,1.,0.));
#30=IFCDIRECTION((1.,0.,0.));
#31=IFCDIRECTION(${direction});
#40=IFCMEMBER('${PARAMETRIC_MEMBER_GLOBAL_ID}',$,'Parametric Member',$,$,#15,#20,$,.MEMBER.);
#41=IFCMATERIAL('Parametric Steel',$,$);
#42=IFCRELASSOCIATESMATERIAL('1123456789ABCDEFGHIJKL',$,$,$,(#40),#41);
ENDSEC;
END-ISO-10303-21;`;

  return new TextEncoder().encode(source);
}

export function parametricSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
