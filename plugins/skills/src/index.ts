// @ji.dev/plugin-skills: the folders under a directory, each with a SKILL.md, as Claude Code keeps them. A user
// message `/name args` hands the model the file.
//
//   typed      /review the diff
//   history    skill://review@3f2a9c1d04b7 the diff      input: a call, with the hash of the version used
//   request    Base directory for this skill: …          request: the call resolved to that version's instructions
//              # Review …
//              ARGUMENTS: the diff
//
//   The history keeps the call, not the file: a skill used ten times is stored once, and a request sends the version
//   that was called, not whatever the file says today. A reload changes what the next /review means, never what an
//   earlier one meant. A call with a hash never loaded (a session resumed after the skill changed) takes the skill's
//   current version; one with no skill of that name at all goes to the model as it is.
//
//   The model is told which skills there are, each with where its SKILL.md is, so it reads one when a task calls for
//   that skill and nobody typed /name: the coding agent run without a terminal on a benchmark task, say.
//
//   plugin    createSkillsPlugin(dir): the input and request hooks, skills() and reload()
//   call   the two text forms, `/name args` and `skill://name@hash args`
//   skill     a SKILL.md folder read into a Skill, and the instructions the model gets for it

export { commandLineOf, formatSkillCall, parseSkillCall, type SkillCall } from './call.ts'
export { createSkillsPlugin, type SkillsPlugin } from './plugin.ts'
export { instructionsOf, loadSkills, type Skill } from './skill.ts'
