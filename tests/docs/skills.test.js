// tests/docs/skills.test.js
//
// The skills in .claude/skills/ (TODO.md, "Claude skills for building plugins") are instructions an agent follows, and a skill that names a
// file, a command or a figure that is not true sends the next agent after something that is not there. Nothing reads prose, so this
// binds it: every skill is well formed, every repository path and npm script it names exists, and the figures it quotes are the
// repository's. It walks .claude/skills as it is now, so a skill added later is in scope.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const skillsDir = join(root, '.claude/skills')
const skills = existsSync(skillsDir)
  ? readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => ({ name: e.name, file: join(skillsDir, e.name, 'SKILL.md') }))
  : []
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts

describe('the skills', () => {
  it('are found, or every check below passes over nothing', () => {
    expect(skills.map(s => s.name)).toContain('html-skin')
  })

  for (const { name, file } of skills) {
    describe(name, () => {
      const text = readFileSync(file, 'utf8')

      it('has a name that is its directory\'s, and a description that says when to use it', () => {
        const front = /^---\n([\s\S]*?)\n---\n/.exec(text)
        expect(front, 'no frontmatter').not.toBeNull()
        expect(/^name: (.+)$/m.exec(front[1])?.[1]).toBe(name)
        const description = /^description: (.+)$/m.exec(front[1])?.[1] ?? ''
        expect(description.length).toBeGreaterThan(60)
        expect(description).toMatch(/\bUse when\b/)
      })

      it('names only repository files that exist', () => {
        const named = new Set()
        // A markdown link is relative to the skill; a path in backticks or a command is relative to the repository.
        for (const [, target] of text.matchAll(/\]\(([^)#\s]+)\)/g)) {
          if (/^https?:/.test(target)) continue
          expect(existsSync(resolve(dirname(file), target)), `link ${target}`).toBe(true)
        }
        // Every repository path wherever it is written: in backticks, in a fenced command, behind `$root/` in a build.sh excerpt, or
        // in prose. A path starts a token, so `bin/x.test.js` inside `tests/bin/x.test.js` is not read as a second path. A placeholder
        // ends the match (`plugins/<name>/x` gives `plugins/`), so a pattern is never mistaken for a file. This was three patterns
        // that each missed a place a path can be, found by breaking a path in a code block and seeing nothing fail.
        for (const [, p] of text.matchAll(/(?:(?<![\w/.$-])|(?<=\$root\/))((?:bin|src|tests|docs|plugins|web)\/[^\s`'")<>*,;:]*[\w/])/g)) named.add(p)
        for (const p of named) {
          // A placeholder or a pattern is not a path.
          if (/[<>*]/.test(p)) continue
          expect(existsSync(join(root, p)), `path ${p}`).toBe(true)
        }
        // Enough to know the extraction found something, not a demand that every skill be heavy with paths.
        expect(named.size).toBeGreaterThan(0)
      })

      it('names only npm scripts that exist', () => {
        const used = [...text.matchAll(/npm run ([\w:-]+)/g)].map(m => m[1])
        for (const script of used) expect(scripts[script], `npm run ${script}`).toBeDefined()
      })

      it('quotes the port counts of any plugin it names with a figure truthfully, and those plugins have the skin it says they have', () => {
        const quoted = [...text.matchAll(/\b(Canticle|Drumkit|Quartet) \((\d+) ports?\)/g)]
        // Every plugin the skill names with a figure, so one written without the word "ports" cannot quietly escape the check.
        expect([...text.matchAll(/\b(Canticle|Drumkit|Quartet) \(\d+/g)].length).toBe(quoted.length)
        for (const [, plugin, count] of quoted) {
          const dir = join(root, 'plugins', plugin.toLowerCase())
          expect(existsSync(join(dir, 'skin/skin.html')), `${plugin} has no HTML skin`).toBe(true)
          expect(JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8')).ports.length, `${plugin}'s port count`).toBe(Number(count))
        }
      })

      // A skill that quotes figures is one that was written from them, so losing every one is a change worth failing on.
      it('keeps the figures it was written from', () => {
        if (name === 'html-skin') expect([...text.matchAll(/\b(Canticle|Drumkit|Quartet) \((\d+) ports?\)/g)]).toHaveLength(3)
      })
    })
  }
})
