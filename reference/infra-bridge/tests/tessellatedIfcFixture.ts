import { createHash } from 'node:crypto';

export const SYNTHETIC_MEMBER_GLOBAL_ID = '0123456789ABCDEFGHIJKL';
export const REPEATED_MEMBER_GLOBAL_ID = '3123456789ABCDEFGHIJKL';

export interface SyntheticTessellatedIfcOptions {
  readonly indexCase?: 'valid' | 'zero-based' | 'open-shell';
  readonly pnIndex?: 'present' | 'absent' | 'out-of-range';
  readonly representation?: 'face-set' | 'bare-point-list';
  readonly representationSet?: 'body-only' | 'axis-and-body';
  readonly closed?: boolean;
  readonly lengthUnit?: 'centimetre' | 'angle-only';
  readonly placement?: 'nested' | 'missing';
  readonly repeatedProduct?: boolean;
  readonly mappedProducts?: boolean;
  readonly bodyItems?: 'single' | 'two';
}

export function syntheticTessellatedIfc(options: SyntheticTessellatedIfcOptions = {}): Uint8Array {
  const coordIndex =
    options.indexCase === 'zero-based'
      ? '((0,3,2),(1,2,4),(2,3,4),(3,1,4))'
      : options.indexCase === 'open-shell'
        ? '((1,3,2),(1,2,4),(2,3,4))'
        : '((1,3,2),(1,2,4),(2,3,4),(3,1,4))';
  const representationItem = options.representation === 'bare-point-list' ? '#23' : '#22';
  const directRepresentationItems =
    options.bodyItems === 'two' && options.representation !== 'bare-point-list'
      ? `${representationItem},#27`
      : representationItem;
  const representations = options.representationSet === 'axis-and-body' ? '#19,#21' : '#21';
  const pointCoordinates =
    options.pnIndex === 'absent'
      ? '((0.,0.,0.),(1.,0.,0.),(0.,1.,0.),(0.,0.,1.))'
      : '((99.,99.,99.),(0.,0.,0.),(1.,0.,0.),(0.,1.,0.),(0.,0.,1.))';
  const pnIndex =
    options.pnIndex === 'absent'
      ? '$'
      : options.pnIndex === 'out-of-range'
        ? '(2,3,4,6)'
        : '(2,3,4,5)';
  const closed = options.closed === false ? '.F.' : '.T.';
  const unit =
    options.lengthUnit === 'angle-only'
      ? 'IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'
      : 'IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.)';
  const placement = options.placement === 'missing' ? '$' : '#15';
  const source = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME('synthetic-tessellated.ifc','2026-08-19T00:00:00',('brepjs'),('brepjs'),'brepjs','brepjs','');
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1=IFCPROJECT('1123456789ABCDEFGHIJKL',$,'Synthetic Project',$,$,$,$,(#2),#6);
#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#3,$);
#3=IFCAXIS2PLACEMENT3D(#4,$,$);
#4=IFCCARTESIANPOINT((0.,0.,0.));
#6=IFCUNITASSIGNMENT((#7));
#7=${unit};
#10=IFCLOCALPLACEMENT($,#11);
#11=IFCAXIS2PLACEMENT3D(#12,#13,#14);
#12=IFCCARTESIANPOINT((10.,20.,0.));
#13=IFCDIRECTION((0.,0.,1.));
#14=IFCDIRECTION((0.,1.,0.));
#15=IFCLOCALPLACEMENT(#10,#16);
#16=IFCAXIS2PLACEMENT3D(#17,$,$);
#17=IFCCARTESIANPOINT((1.,0.,0.5));
#18=IFCPOLYLINE((#33,#34));
#19=IFCSHAPEREPRESENTATION(#2,'Axis','Curve2D',(#18));
#20=IFCPRODUCTDEFINITIONSHAPE($,$,(${options.mappedProducts === true ? '#21' : representations}));
#21=IFCSHAPEREPRESENTATION(#2,'Body','${options.mappedProducts === true ? 'MappedRepresentation' : 'Tessellation'}',(${options.mappedProducts === true ? '#25' : directRepresentationItems}));
#22=IFCTRIANGULATEDFACESET(#23,$,${closed},${coordIndex},${pnIndex});
#23=IFCCARTESIANPOINTLIST3D(${pointCoordinates});
#27=IFCTRIANGULATEDFACESET(#28,$,${closed},${coordIndex},${pnIndex});
#28=IFCCARTESIANPOINTLIST3D(${options.pnIndex === 'absent' ? '((2.,0.,0.),(3.,0.,0.),(2.,1.,0.),(2.,0.,1.))' : '((99.,99.,99.),(2.,0.,0.),(3.,0.,0.),(2.,1.,0.),(2.,0.,1.))'});
#24=IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#26,1.,$);
#25=IFCMAPPEDITEM(#50,#24);
#26=IFCCARTESIANPOINT((2.,0.,0.));
#40=IFCPRODUCTDEFINITIONSHAPE($,$,(#41));
#41=IFCSHAPEREPRESENTATION(#2,'Body','MappedRepresentation',(#45));
#44=IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#46,1.,$);
#45=IFCMAPPEDITEM(#50,#44);
#46=IFCCARTESIANPOINT((3.,0.,0.));
#50=IFCREPRESENTATIONMAP(#52,#51);
#51=IFCSHAPEREPRESENTATION(#2,'Body','Tessellation',(#22));
#52=IFCAXIS2PLACEMENT3D(#53,$,$);
#53=IFCCARTESIANPOINT((1.,0.,0.));
#30=IFCMEMBER('${SYNTHETIC_MEMBER_GLOBAL_ID}',$,'Synthetic Member',$,$,${placement},#20,$,.MEMBER.);
#35=IFCMEMBER('${REPEATED_MEMBER_GLOBAL_ID}',$,'Repeated Member',$,$,${placement},${options.mappedProducts === true ? '#40' : '#20'},$,.MEMBER.);
#31=IFCMATERIAL('Synthetic Steel',$,$);
#32=IFCRELASSOCIATESMATERIAL('2123456789ABCDEFGHIJKL',$,$,$,(#30${options.repeatedProduct === true ? ',#35' : ''}),#31);
#33=IFCCARTESIANPOINT((0.,0.));
#34=IFCCARTESIANPOINT((1.,0.));
ENDSEC;
END-ISO-10303-21;`;

  const withProducts = options.repeatedProduct === true ? source : source.replace(/^#35=.*\n/m, '');
  const withBodyItems =
    options.bodyItems === 'two'
      ? withProducts
      : withProducts.replace(/^#27=.*\n/m, '').replace(/^#28=.*\n/m, '');
  return new TextEncoder().encode(withBodyItems);
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
