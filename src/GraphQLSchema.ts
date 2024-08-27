import { AST, Schema as S } from '@effect/schema';
import { Data, Match, Option, Predicate, Record, String, Tuple } from 'effect';
import { compose } from 'effect/Function';
import type { Simplify } from 'effect/Types';

export type TypeRef = Data.TaggedEnum<{
	Named: { identifier: string; nullable: boolean };
	List: { type: TypeRef; nullable: boolean };
}>;
export const TypeRef = Data.taggedEnum<TypeRef>();
export type TypeDef = Data.TaggedEnum<{
	Type: {
		identifier: string;
		fields: Record<string, TypeRef>;
	};
	Input: {
		identifier: string;
		fields: Record<string, TypeRef>;
	};
	Enum: { identifier: string; members: string[] };
	Union: { identifier: string; members: string[] };
	OneOf: { identifier: string; members: Record<string, string> };
}>;
export const TypeDef = Data.taggedEnum<TypeDef>();
type TypeDefs = Record<string, TypeDef>;

export type Schema<A = unknown> = {
	typeRef: TypeRef;
	typeDefs: TypeDefs;
};
export const Schema = Data.case<Schema>();

const named = (identifier: string): TypeRef => TypeRef.Named({ identifier, nullable: false });
const list = (type: TypeRef): TypeRef => TypeRef.List({ type, nullable: false });
const nullable = (ref: TypeRef): TypeRef => ({ ...ref, nullable: true });

export const make = <A, I, R>(schema: S.Schema<A, I, R>): Schema<A> => {
	const typeDefs: TypeDefs = {};
	const [typeRef] = createAndResolveType(schema.ast, typeDefs);
	return Schema({ typeRef, typeDefs });
};

export const asType = (schema: Schema): Option.Option<Extract<TypeDef, { _tag: 'Type' }>> => {
	if (schema.typeRef._tag !== 'Named') return Option.none();
	const type = schema.typeDefs[schema.typeRef.identifier];
	if (type === undefined) return Option.none();
	if (type._tag !== 'Type') return Option.none();
	return Option.some(type);
};

type OnlyRequired<T> = {
	[K in keyof T as T[K] extends Exclude<T[K], null | undefined> ? K : never]: T[K];
};
type OnlyOptional<T> = {
	[K in keyof T as T[K] extends Exclude<T[K], null | undefined> ? never : K]: T[K];
};
type Optional<T> = { [K in keyof T]?: T[K] };
type NullableToOptional<T> = Simplify<OnlyRequired<T> & Optional<OnlyOptional<T>>>;
export type Encoded<T> =
	T extends Record<string, unknown>
		? { [K in keyof T]: Encoded<T[K]> }
		: T extends Option.Option<infer A>
			? Encoded<A> | null
			: T extends readonly (infer A)[]
				? Encoded<A>[]
				: T;
export type Decodable<T> =
	T extends Record<string, unknown>
		? NullableToOptional<{ [K in keyof T]: Decodable<T[K]> }>
		: T extends Option.Option<infer A>
			? Decodable<A> | null | undefined
			: T extends readonly (infer A)[]
				? Decodable<A>[]
				: T extends string
					? string
					: T;
export const encode = <A>(schema: Schema<A>) => {
	const encodeType = (ref: TypeRef, data: unknown): unknown =>
		TypeRef.$match(ref, {
			List: (list) => {
				const value = Option.isOption(data) ? Option.getOrNull(data) : data;

				if (!list.nullable && value == null)
					throw new Error('Failed to encode type as it is not nullable');
				if (value == null) return null;
				if (!Array.isArray(value))
					throw new Error(`Failed to encode type '${value}' as it was not an array`);

				return value.map((data) => encodeType(list.type, data));
			},
			Named: (named) => {
				const value = Option.isOption(data) ? Option.getOrNull(data) : data;

				if (!named.nullable && value == null)
					throw new Error('Failed to encode type as it is not nullable');
				if (value == null) return null;

				const type = schema.typeDefs[named.identifier];
				if (!type) return value;

				return TypeDef.$match(type, {
					Type: (type) => {
						if (!Predicate.isRecord(value))
							throw new Error(`Failed to encode type '${value}' as it was not an object`);

						return Record.map(type.fields, (ref, key) => encodeType(ref, value[key]));
					},
					Input: () => {
						throw new Error('Input encoding not implemented');
					},
					Enum: (enum_) => {
						if (!Predicate.isString(value))
							throw new Error(`Failed to encode type '${value}' as it was not a string`);
						if (!enum_.members.includes(value))
							throw new Error(
								`Failed to encode type '${value}' as it was not a member of the enum`,
							);
						return value;
					},
					Union: () => {
						throw new Error('Union encoding not implemented');
					},
					OneOf: () => {
						throw new Error('OneOf encoding not implemented');
					},
				});
			},
		});
	return (data: A): Encoded<A> => encodeType(schema.typeRef, data) as Encoded<A>;
};
export const decode = <A>(schema: Schema<A>) => {
	const decodeType = (ref: TypeRef, data: unknown): unknown =>
		TypeRef.$match(ref, {
			List: (list) => {
				if (!list.nullable && data == null)
					throw new Error('Failed to decode type as it is not nullable');
				if (data == null) return Option.none();
				if (!Array.isArray(data))
					throw new Error(`Failed to decode type '${data}' as it was not an array`);

				const value = data.map((data) => decodeType(list.type, data));
				return list.nullable ? Option.some(value) : value;
			},
			Named: (named) => {
				if (!named.nullable && data == null)
					throw new Error('Failed to decode type as it is not nullable');
				if (data == null) return Option.none();

				const type = schema.typeDefs[named.identifier];
				const value = type
					? TypeDef.$match(type, {
							Type: (type) => {
								if (!Predicate.isRecord(data))
									throw new Error(`Failed to decode type '${data}' as it was not an object`);

								return Record.map(type.fields, (ref, key) => decodeType(ref, data[key]));
							},
							Input: () => {
								throw new Error('Input decoding not implemented');
							},
							Enum: (enum_) => {
								if (!Predicate.isString(data))
									throw new Error(`Failed to decode type '${data}' as it was not a string`);
								if (!enum_.members.includes(data))
									throw new Error(
										`Failed to decode type '${data}' as it was not a member of the enum`,
									);
								return data;
							},
							Union: () => {
								throw new Error('Union decoding not implemented');
							},
							OneOf: () => {
								throw new Error('OneOf decoding not implemented');
							},
						})
					: data;
				return named.nullable ? Option.some(value) : value;
			},
		});
	return (data: Decodable<A>): A => decodeType(schema.typeRef, data) as A;
};

type Mapping = Record<string, string>;
export const toString = (schema: Schema, mapping?: Mapping): string =>
	makeGqlSchema(schema.typeDefs, mapping);

const makeGqlSchema = (typeDefs: TypeDefs, mapping: Mapping = {}): string =>
	Record.values(typeDefs)
		.map((def) => typeDefToGql(def, mapping))
		.join('\n\n');
const typeDefToGql = (typeDef: TypeDef, mapping: Mapping) =>
	Match.typeTags<TypeDef>()({
		Type: (typeDef) => `type ${typeDef.identifier} {
	${Record.toEntries(typeDef.fields)
		.map((f) => fieldToGql(f, mapping))
		.join('\n	')}
}`,
		Input: (typeDef) => `input ${typeDef.identifier} {
	${Record.toEntries(typeDef.fields)
		.map((f) => fieldToGql(f, mapping))
		.join('\n	')}
}`,
		Enum: (typeDef) => `enum ${typeDef.identifier} {
	${typeDef.members.join('\n	')}
}`,
		Union: (typeDef) => `union ${typeDef.identifier} =
	  | ${typeDef.members.join('\n	| ')}`,
		OneOf: (typeDef) => `input ${typeDef.identifier} @oneOf {
	${Record.toEntries(typeDef.members)
		.map(([name, type]) => `${name}: ${type}`)
		.join('\n	')}
}`,
	})(typeDef);
const fieldToGql = ([name, value]: [string, TypeRef], mapping: Mapping): string =>
	`${name}: ${typeRefToGql(value, mapping)}`;
const typeRefToGql = (ref: TypeRef, mapping: Mapping) =>
	Match.typeTags<TypeRef>()({
		Named: (ref) => (mapping[ref.identifier] ?? ref.identifier) + (ref.nullable ? '' : '!'),
		List: (ref): string => `[${typeRefToGql(ref.type, mapping)}]` + (ref.nullable ? '' : '!'),
	})(ref);

const asList = Tuple.mapFirst(list);
const asNullable = Tuple.mapFirst(nullable);
const createAndResolveType = (ast: AST.AST, typeDefs: TypeDefs): [TypeRef, AST.AST] => {
	const resolveType = getResolveType(ast);
	if (Option.isSome(resolveType)) {
		// If resolve type is set, we can assume the type is already defined
		return [resolveType.value, ast];
	}

	const identifier = getIdentifier(ast);
	if (Option.isNone(identifier)) {
		if (AST.isRefinement(ast)) {
			// TODO: do we need to otherwise handle refinements?
			return createAndResolveType(ast.from, typeDefs);
		}
		if (AST.isTupleType(ast)) {
			if (ast.elements.length > 0) {
				throw new Error('Tuples are not supported in GraphQL');
			}
			if (ast.rest.length !== 1) {
				throw new Error('Arrays must contain a single type in GraphQL');
			}
			return asList(createAndResolveType(ast.rest[0]!.type, typeDefs));
		}
		if (AST.isUnion(ast)) {
			// Attempt to find out if its a simple union with null
			if (ast.types.length === 2) {
				let [type, null_] = ast.types;
				if (AST.isLiteral(type) && type.literal === null) {
					[type, null_] = [null_, type];
				}

				return asNullable(createAndResolveType(type, typeDefs));
			}
		}
		if (AST.isTransformation(ast)) {
			return createAndResolveType(ast.to, typeDefs);
		}
		if (AST.isDeclaration(ast)) {
			// Attempt to determine if its an OptionFromSelf declaration,
			// in which case we convert to nullable type
			if (
				ast.typeParameters.length === 1 &&
				AST.getDescriptionAnnotation(ast).pipe(Option.exists((d) => d.startsWith('Option<')))
			) {
				const type = ast.typeParameters[0]!;
				return asNullable(createAndResolveType(type, typeDefs));
			}
		}

		throw new Error('found unidentified type: ' + ast);
	}

	if (Record.has(typeDefs, identifier.value)) {
		// TODO: check if they are compatible?
		return [named(identifier.value), ast];
	}

	Match.value(ast).pipe(
		Match.tag('TypeLiteral', (lit) => {
			if (lit.indexSignatures.length > 0) {
				throw new Error('GraphQL does not support index signatures');
			}
			const fields = lit.propertySignatures.map((sig) => {
				if (typeof sig.name !== 'string') {
					throw new Error('GraphQL types must have only string keys');
				}
				const [type] = createAndResolveType(sig.type, typeDefs);
				return [sig.name, sig.isOptional ? nullable(type) : type] as const;
			});

			typeDefs[identifier.value] = TypeDef.Type({
				identifier: identifier.value,
				fields: Record.fromEntries(fields),
			});
			const inputName = identifier.value + 'Input';
			typeDefs[inputName] = TypeDef.Input({
				identifier: inputName,
				fields: Record.fromEntries(fields),
			});
		}),
		Match.tag('Union', (union) => {
			if (union.types.every(AST.isLiteral)) {
				// TODO: handle graphql unions
				const members = union.types.map((member) => {
					if (!AST.isLiteral(member) || !Match.string(member.literal))
						throw new Error('Literal unions must all be strings to be considered GraphQL enums');
					return member.literal;
				});
				typeDefs[identifier.value] = TypeDef.Enum({
					identifier: identifier.value,
					members,
				});
			} else {
				const memberDefs: TypeDefs = {};
				const members = union.types.map((member) => {
					const [typeRef, ast] = createAndResolveType(member, memberDefs);
					if (typeRef._tag !== 'Named') {
						throw new Error('Unions only support named types, got' + typeRef);
					}
					return {
						identifier: typeRef.identifier,
						inputKey: getInputKey(ast).pipe(
							Option.getOrElse(() => pascalToCamel(typeRef.identifier)),
						),
						// TODO: actually resolve input identifier
						inputIdentifier: typeRef.identifier + 'Input',
					};
				});
				typeDefs[identifier.value] = TypeDef.Union({
					identifier: identifier.value,
					members: members.map((m) => m.identifier),
				});
				const inputName = identifier.value + 'Input';
				typeDefs[inputName] = TypeDef.OneOf({
					identifier: inputName,
					members: Record.fromEntries(members.map((m) => [m.inputKey, m.inputIdentifier])),
				});
				// TODO: check for conflicts?
				Object.assign(typeDefs, memberDefs);
			}
		}),
		Match.option,
	);

	return [named(identifier.value), ast];
};

const pascalToCamel = compose(String.pascalToSnake, String.snakeToCamel);

export const ResolveTypeAnnotationID = Symbol.for(
	'@peopleplus/effect-graphql/annotation/ResolveType',
);
export const resolveType =
	(identifier: string) =>
	<A, I, R>(self: S.Schema<A, I, R>): S.Schema<A, I, R> =>
		S.make(
			AST.annotations(self.ast, {
				[ResolveTypeAnnotationID]: named(identifier),
			}),
		);
export const resolveNullableType =
	(identifier: string) =>
	<A, I, R>(self: S.Schema<A, I, R>): S.Schema<A, I, R> =>
		S.make(
			AST.annotations(self.ast, {
				[ResolveTypeAnnotationID]: nullable(named(identifier)),
			}),
		);
export const getResolveType = AST.getAnnotation<TypeRef>(ResolveTypeAnnotationID);

export const IdentifierAnnotationID = Symbol.for(
	'@peopleplus/effect-graphql/annotation/Identifier',
);
export const identifier =
	(id: string) =>
	<A, I, R>(self: S.Schema<A, I, R>): S.Schema<A, I, R> =>
		S.make(AST.annotations(self.ast, { [IdentifierAnnotationID]: id }));
export const getIdentifierAnnotation = AST.getAnnotation<string>(IdentifierAnnotationID);

export const getIdentifier = (annotated: AST.AST) =>
	getIdentifierAnnotation(annotated).pipe(
		Option.orElse(() => AST.getIdentifierAnnotation(annotated)),
		Option.orElse(() => getBuiltinIdentifier(annotated)),
	);

export const InputKeyAnnotationID = Symbol.for('@peopleplus/effect-graphql/annotation/InputKey');
export const inputKey =
	(identifier: string) =>
	<A, I, R>(self: S.Schema<A, I, R>): S.Schema<A, I, R> =>
		S.make(
			AST.annotations(self.ast, {
				[InputKeyAnnotationID]: identifier,
			}),
		);
export const getInputKey = AST.getAnnotation<string>(InputKeyAnnotationID);

export const getBuiltinIdentifier = Match.type<AST.AST>().pipe(
	Match.tag('StringKeyword', () => 'String'),
	Match.tag('NumberKeyword', () => 'Float'),
	Match.tag('BooleanKeyword', () => 'Boolean'),
	Match.whenAnd({ _tag: 'Literal', literal: Match.string }, () => 'String'),
	Match.whenAnd({ _tag: 'Literal', literal: Match.number }, () => 'Float'),
	Match.whenAnd({ _tag: 'Literal', literal: Match.boolean }, () => 'Boolean'),
	Match.option,
);
