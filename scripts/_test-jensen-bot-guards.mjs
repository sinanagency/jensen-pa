// Jensen PA bot-guards integration test.

import { sanitizeReply } from '../lib/bot-guards/index.js'
import { JENSEN_BOT_GUARDS_CONFIG } from '../lib/bot/guards-config.js'

const cases = [
  { name: 'Sasa brand leak caught',           body: "I'll loop Sasa in on this.",                            mustCatch: true,  expectKind: 'forbidden_brand' },
  { name: 'Nisria brand leak caught',         body: "Reach out to Nisria for next steps.",                   mustCatch: true,  expectKind: 'forbidden_brand' },
  { name: 'Stephen leak caught',              body: "Stephen has the 4Q framework ready.",                   mustCatch: true,  expectKind: 'forbidden_brand' },
  { name: 'Cape Town Halaal leak caught',     body: "Forwarding to Cape Town Halaal team.",                  mustCatch: true,  expectKind: 'forbidden_brand' },
  { name: 'Maisha leak caught',               body: "Maisha can help with the proposal.",                    mustCatch: true,  expectKind: 'forbidden_brand' },
  // CRITICAL: 4Q + four quadrants are LEGITIMATE for Jensen (his consultancy framework)
  { name: '4Q legitimate — must pass',        body: "Let's break this down using the 4Q framework.",         mustCatch: false },
  { name: 'four quadrants legitimate — must pass', body: "I'll prioritise using the Eisenhower four quadrants.", mustCatch: false },
  { name: 'consultancy reply passes',         body: "I drafted the Upaya cost strategy. Want me to send it?", mustCatch: false },
  { name: 'calendar reply passes',            body: "You have the Sohum meeting at 3pm Thursday.",            mustCatch: false },
  { name: 'mail draft passes',                body: "I drafted a reply to Pixel Stamp. Approve?",            mustCatch: false },
]

let pass = 0, fail = 0
for (const c of cases) {
  const out = sanitizeReply(c.body, JENSEN_BOT_GUARDS_CONFIG)
  const caught = !!out.caught
  const ok = caught === c.mustCatch && (c.mustCatch ? out.caught?.kind === c.expectKind : true)
  if (ok) { pass++; console.log(`✅ ${c.name}`) }
  else {
    fail++
    console.log(`❌ ${c.name}`)
    console.log(`   body: ${JSON.stringify(c.body)}`)
    console.log(`   got: caught=${caught}${out.caught ? ' kind=' + out.caught.kind + ' pattern=' + out.caught.pattern : ''}`)
    console.log(`   body out: ${JSON.stringify(out.body)}`)
  }
}
console.log(`\n=== ${pass}/${pass + fail} passed ===`)
process.exit(fail === 0 ? 0 : 1)
