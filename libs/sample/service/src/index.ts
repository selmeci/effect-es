import { Context, type Effect } from "effect"
import type {
  AlbumQuotaExceededError,
  CreatePhotoInput,
  Photo,
  PhotoNotFoundError
} from "@harness/sample-contract"

export class PhotoRepo extends Context.Service<
  PhotoRepo,
  {
    readonly insert: (input: CreatePhotoInput) => Effect.Effect<Photo>
    readonly findById: (id: number) => Effect.Effect<Photo, PhotoNotFoundError>
    readonly listAll: Effect.Effect<ReadonlyArray<Photo>>
  }
>()("PhotoRepo") {}

export class AlbumCounterClient extends Context.Service<
  AlbumCounterClient,
  {
    readonly increment: (albumId: string) => Effect.Effect<number, AlbumQuotaExceededError>
    readonly getCount: (albumId: string) => Effect.Effect<number>
  }
>()("AlbumCounterClient") {}
