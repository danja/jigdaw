// src/validate/ShapeValidator.js
import rdf from '@zazuko/env'
import SHACLValidator from 'rdf-validate-shacl'

const WARNING = 'http://www.w3.org/ns/shacl#Warning'

/**
 * Validates graphs against a set of SHACL shapes.
 *
 * Exists as a class rather than a function to hold the parsed shapes, which are
 * the expensive part: validating twenty profiles should parse the shapes once.
 */
export class ShapeValidator {
  #validator

  constructor (shapes) {
    this.#validator = new SHACLValidator(shapes, { factory: rdf })
  }

  /**
   * Returns { conforms, violations, warnings, results }.
   *
   * `conforms` is corrected here and deliberately differs from what
   * rdf-validate-shacl reports. SHACL section 3.6 says a result of warning
   * severity does not make a graph non-conformant; the library reports
   * conforms: false for any result at all. Callers refuse to store a
   * non-conformant graph, so without this correction one odd string of
   * warning severity would abort an entire harvest.
   */
  async validate (data) {
    const report = await this.#validator.validate(data)
    const results = report.results.map(r => ({
      severity: r.severity?.value ?? null,
      focusNode: r.focusNode?.value ?? null,
      path: r.path?.value ?? null,
      message: r.message.map(m => m.value).join(' ')
    }))
    const violations = results.filter(r => r.severity !== WARNING)
    const warnings = results.filter(r => r.severity === WARNING)
    return { conforms: violations.length === 0, violations, warnings, results }
  }
}
