import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AtomHttpApi, AtomRegistry } from "effect/reactivity"
import { SampleApi, type Photo } from "@harness/sample-contract"
import {
  SampleApiClient,
  listPhotosAtom,
  getPhotoByIdAtom,
  createPhotoMutation
} from "../src/client.js"
import { execSync } from "node:child_process"
import * as path from "node:path"
import * as fs from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../../..")

const testPhotos: readonly Photo[] = [
  { id: 1, name: "photo1.jpg", albumId: "vacation", createdAt: 1000 },
  { id: 2, name: "photo2.jpg", albumId: "vacation", createdAt: 2000 }
]

describe("SampleApiClient and AtomHttpApi", () => {
  it("exports SampleApiClient and derived query and mutation atoms", () => {
    expect(SampleApiClient).toBeDefined()
    expect(listPhotosAtom).toBeDefined()
    expect(getPhotoByIdAtom).toBeDefined()
    const photo1Atom = getPhotoByIdAtom(1)
    expect(photo1Atom).toBeDefined()
    expect(createPhotoMutation).toBeDefined()
  })

  it("executes typed queries and mutations against SampleApi via AtomRegistry", async () => {
    const MockSampleApiClient = AtomHttpApi.Service<any>()("MockSampleApiClient", {
      api: SampleApi,
      baseUrl: "http://localhost:8787",
      httpClient: Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            const url = new URL(request.url)
            if (request.method === "GET" && url.pathname === "/photos") {
              return HttpClientResponse.fromWeb(request, Response.json(testPhotos))
            }
            if (request.method === "GET" && url.pathname === "/photos/1") {
              return HttpClientResponse.fromWeb(request, Response.json(testPhotos[0]))
            }
            if (request.method === "POST" && url.pathname === "/photos") {
              const newPhoto: Photo = {
                id: 3,
                name: "new.jpg",
                albumId: "vacation",
                createdAt: 3000
              }
              return HttpClientResponse.fromWeb(request, Response.json(newPhoto))
            }
            return HttpClientResponse.fromWeb(request, new Response("Not found", { status: 404 }))
          })
        )
      )
    })

    const queryAtom = MockSampleApiClient.query("photos", "listPhotos", {})
    const getAtom = MockSampleApiClient.query("photos", "getPhoto", { params: { id: 1 } })
    const mutation = MockSampleApiClient.mutation("photos", "createPhoto")

    const registry = AtomRegistry.make()
    try {
      const photos = await Effect.runPromise(
        AtomRegistry.getResult(registry, queryAtom, { suspendOnWaiting: true })
      )
      expect(photos).toEqual(testPhotos)

      const single = await Effect.runPromise(
        AtomRegistry.getResult(registry, getAtom, { suspendOnWaiting: true })
      )
      expect(single).toEqual(testPhotos[0])

      registry.set(mutation, { payload: { name: "new.jpg", albumId: "vacation" } })
      const created = await Effect.runPromise(
        AtomRegistry.getResult(registry, mutation, { suspendOnWaiting: true })
      )
      expect(created).toEqual({ id: 3, name: "new.jpg", albumId: "vacation", createdAt: 3000 })
    } finally {
      registry.dispose()
    }
  })

  it("enforces fetch ban in apps/sample-web/src via oxlint", () => {
    const tempFile = path.resolve(__dirname, "../src/temp-fetch-ban-test.ts")
    try {
      fs.writeFileSync(tempFile, 'export const bad = fetch("http://localhost:8787/photos")\n')
      let failed = false
      let output = ""
      try {
        output = execSync("pnpm exec oxlint apps/sample-web/src/temp-fetch-ban-test.ts", {
          cwd: repoRoot,
          stdio: "pipe",
          encoding: "utf-8"
        })
      } catch (err: any) {
        failed = true
        output = (err.stdout ?? "") + (err.stderr ?? "")
      }
      expect(failed).toBe(true)
      expect(output).toMatch(/fetch/i)
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  })

  it("enforces scope:web boundary in apps/sample-web/src via oxlint", () => {
    const tempFile = path.resolve(__dirname, "../src/temp-scope-boundary-test.ts")
    try {
      fs.writeFileSync(
        tempFile,
        'import { greet } from "@harness/sample-domain"\nexport const bad = greet\n'
      )
      let failed = false
      let output = ""
      try {
        output = execSync("pnpm --filter sample-web run lint", {
          cwd: repoRoot,
          stdio: "pipe",
          encoding: "utf-8"
        })
      } catch (err: any) {
        failed = true
        output = (err.stdout ?? "") + (err.stderr ?? "")
      }
      expect(failed).toBe(true)
      expect(output).toMatch(/scope:web|contract/i)
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  })
})
