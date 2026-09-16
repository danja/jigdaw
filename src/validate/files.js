// src/validate/files.js
//
// The node-only half of validation: reading Turtle off disk. Kept apart from
// ShapeValidator so that importing the validator into a browser bundle does not
// drag node:fs in with it.
import { readFile } from 'node:fs/promises'
import { parseText } from '../rdf/parse.js'
import { ShapeValidator } from './ShapeValidator.js'

export async function parseTurtleFile (path, baseIRI = `file://${path}`) {
  return parseText(await readFile(path, 'utf8'), baseIRI)
}

export async function shapeValidatorFromFile (shapesPath) {
  return new ShapeValidator(await parseTurtleFile(shapesPath, 'urn:jigdaw:shapes'))
}

export async function validateFile (validator, path, baseIRI = `file://${path}`) {
  return validator.validate(await parseTurtleFile(path, baseIRI))
}
