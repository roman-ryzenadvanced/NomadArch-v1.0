import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { redactSecrets, hasSecrets, redactObject } from "../secrets-detector.js"

describe("secrets detector", () => {
  describe("redactSecrets", () => {
    it("redacts API keys", () => {
      const content = "My API key is sk-1234567890abcdef"
      const result = redactSecrets(content, "test")
      assert.ok(result.redactions.length > 0)
      assert.ok(!result.clean.includes("sk-1234567890abcdef"))
    })

    it("redacts AWS access keys", () => {
      const content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
      const result = redactSecrets(content, "test")
      assert.ok(result.redactions.length > 0)
      assert.ok(!result.clean.includes("AKIAIOSFODNN7EXAMPLE"))
    })

    it("redacts bearer tokens", () => {
      const content = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
      const result = redactSecrets(content, "test")
      assert.ok(result.redactions.length > 0)
      assert.ok(!result.clean.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"))
    })

    it("redacts GitHub tokens", () => {
      const content = "github_pat_11AAAAAAAAAAAAAAAAAAAAAA"
      const result = redactSecrets(content, "test")
      assert.ok(result.redactions.length > 0)
      assert.ok(!result.clean.includes("github_pat_11AAAAAAAAAAAAAAAAAAAAAA"))
    })

    it("redacts npm tokens", () => {
      const content = "npm_1234567890abcdef1234567890abcdef1234"
      const result = redactSecrets(content, "test")
      assert.ok(result.redactions.length > 0)
      assert.ok(!result.clean.includes("npm_1234567890abcdef1234567890abcdef1234"))
    })

    it("preserves non-sensitive content", () => {
      const content = "This is a normal message without any secrets"
      const result = redactSecrets(content, "test")
      assert.equal(result.clean, content)
      assert.equal(result.redactions.length, 0)
    })

    it("handles empty content", () => {
      const content = ""
      const result = redactSecrets(content, "test")
      assert.equal(result.clean, "")
      assert.equal(result.redactions.length, 0)
    })

    it("provides redaction reasons", () => {
      const content = "API key: sk-1234567890abcdef"
      const result = redactSecrets(content, "test")
      assert.ok(result.redactions.length > 0)
      assert.ok(result.redactions[0].reason.length > 0)
    })

    it("tracks redaction paths", () => {
      const content = "sk-1234567890abcdef"
      const result = redactSecrets(content, "test")
      assert.ok(result.redactions.length > 0)
      assert.equal(typeof result.redactions[0].path, "string")
      assert.ok(result.redactions[0].path.length > 0)
    })
  })

  describe("hasSecrets", () => {
    it("detects API keys", () => {
      const content = "sk-1234567890abcdef"
      assert.ok(hasSecrets(content))
    })

    it("detects bearer tokens", () => {
      const content = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
      assert.ok(hasSecrets(content))
    })

    it("returns false for normal content", () => {
      const content = "This is a normal message"
      assert.ok(!hasSecrets(content))
    })

    it("returns false for empty content", () => {
      const content = ""
      assert.ok(!hasSecrets(content))
    })
  })

  describe("redactObject", () => {
    it("redacts secrets in nested objects", () => {
      const obj = {
        apiKey: "sk-1234567890abcdef",
        nested: {
          token: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        },
      }
      const result = redactObject(obj, "test")
      assert.ok(!result.apiKey.includes("sk-1234567890abcdef"))
      assert.ok(!result.nested.token.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"))
    })

    it("redacts secrets in arrays", () => {
      const obj = {
        messages: [
          { content: "Use sk-1234567890abcdef" },
          { content: "Normal message" },
        ],
      }
      const result = redactObject(obj, "test")
      assert.ok(!result.messages[0].content.includes("sk-1234567890abcdef"))
      assert.equal(result.messages[1].content, "Normal message")
    })

    it("preserves non-sensitive fields", () => {
      const obj = {
        name: "John Doe",
        age: 30,
        message: "Hello world",
      }
      const result = redactObject(obj, "test")
      assert.equal(result.name, "John Doe")
      assert.equal(result.age, 30)
      assert.equal(result.message, "Hello world")
    })

    it("handles null and undefined values", () => {
      const obj = {
        value: null,
        undefined: undefined,
        message: "sk-1234567890abcdef",
      }
      const result = redactObject(obj, "test")
      assert.equal(result.value, null)
      assert.equal(result.undefined, undefined)
      assert.ok(!result.message.includes("sk-1234567890abcdef"))
    })

    it("preserves object structure", () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              secret: "sk-1234567890abcdef",
            },
          },
        },
      }
      const result = redactObject(obj, "test")
      assert.ok(result.level1.level2.level3.secret)
      assert.ok(!result.level1.level2.level3.secret.includes("sk-1234567890abcdef"))
    })
  })
})
