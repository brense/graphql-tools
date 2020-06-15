import {
  GraphQLCompositeType,
  GraphQLError,
  GraphQLSchema,
  isAbstractType,
  FieldNode,
  GraphQLObjectType,
  GraphQLResolveInfo,
} from 'graphql';

import { collectFields, GraphQLExecutionContext, setErrors, slicedError, collectSubFields } from '@graphql-tools/utils';
import { setObjectSubschema, isSubschemaConfig } from '../Subschema';
import { mergeFields } from '../mergeFields';
import { MergedTypeInfo, SubschemaConfig, StitchingInfo } from '../types';

export function handleObject(
  type: GraphQLCompositeType,
  object: any,
  errors: ReadonlyArray<GraphQLError>,
  subschema: GraphQLSchema | SubschemaConfig,
  context: Record<string, any>,
  info: GraphQLResolveInfo,
  skipTypeMerging?: boolean
) {
  const stitchingInfo = info?.schema.extensions?.stitchingInfo;

  setErrors(
    object,
    errors.map(error => slicedError(error))
  );

  setObjectSubschema(object, subschema);

  if (skipTypeMerging || !stitchingInfo) {
    return object;
  }

  const typeName = isAbstractType(type) ? info.schema.getTypeMap()[object.__typename].name : type.name;
  const mergedTypeInfo = stitchingInfo.mergedTypes[typeName];
  let targetSubschemas: Array<SubschemaConfig>;

  if (mergedTypeInfo != null) {
    targetSubschemas = mergedTypeInfo.subschemas;
  }

  if (!targetSubschemas) {
    return object;
  }

  targetSubschemas = targetSubschemas.filter(s => s !== subschema);
  if (!targetSubschemas.length) {
    return object;
  }

  const fieldNodes = getFieldsNotInSubschema(info, subschema, mergedTypeInfo, object.__typename);

  return mergeFields(
    mergedTypeInfo,
    typeName,
    object,
    fieldNodes,
    [subschema as SubschemaConfig],
    targetSubschemas,
    context,
    info
  );
}

function collectSubFieldsFromInfo(info: GraphQLResolveInfo, typeName: string): Record<string, Array<FieldNode>> {
  const type = info.schema.getType(typeName) as GraphQLObjectType;
  const partialExecutionContext = ({
    schema: info.schema,
    variableValues: info.variableValues,
    fragments: info.fragments,
  } as unknown) as GraphQLExecutionContext;

  let subFieldNodes = collectSubFields(partialExecutionContext, type, info.fieldNodes);

  const selectionSetsByField = (info.schema.extensions.stitchingInfo as StitchingInfo).selectionSetsByField;
  const visitedFragmentNames = Object.create(null);
  Object.keys(subFieldNodes).forEach(responseName => {
    const fieldName = subFieldNodes[responseName][0].name.value;
    if (selectionSetsByField[typeName] && selectionSetsByField[typeName][fieldName]) {
      subFieldNodes = collectFields(
        partialExecutionContext,
        type,
        selectionSetsByField[typeName][fieldName],
        subFieldNodes,
        visitedFragmentNames
      );
    }
  });

  return subFieldNodes;
}

function getFieldsNotInSubschema(
  info: GraphQLResolveInfo,
  subschema: GraphQLSchema | SubschemaConfig,
  mergedTypeInfo: MergedTypeInfo,
  typeName: string
): Array<FieldNode> {
  const typeMap = isSubschemaConfig(subschema) ? mergedTypeInfo.typeMaps.get(subschema) : subschema.getTypeMap();
  const fields = (typeMap[typeName] as GraphQLObjectType).getFields();

  const subFieldNodes = collectSubFieldsFromInfo(info, typeName);

  let fieldsNotInSchema: Array<FieldNode> = [];
  Object.keys(subFieldNodes).forEach(responseName => {
    const fieldName = subFieldNodes[responseName][0].name.value;
    if (!(fieldName in fields)) {
      fieldsNotInSchema = fieldsNotInSchema.concat(subFieldNodes[responseName]);
    }
  });

  return fieldsNotInSchema;
}
