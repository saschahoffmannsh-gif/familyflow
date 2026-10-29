// Alle ursprünglichen API-Routen (app/api/**/route.ts) unverändert eingebunden.
// scripts/build-function.mjs bündelt diese Datei für die Supabase Edge Function.
import * as calendar from '@/app/api/calendar/route'
import * as discussions from '@/app/api/discussions/route'
import * as attachments from '@/app/api/discussions/attachments/route'
import * as media from '@/app/api/discussions/media/[id]/route'
import * as inbox from '@/app/api/inbox/route'
import * as planner from '@/app/api/planner/route'
import * as unlock from '@/app/api/profile/unlock/route'
import * as daily from '@/app/api/push/daily/route'
import * as subscription from '@/app/api/push/subscription/route'
import * as shopping from '@/app/api/shopping/route'
import * as todo from '@/app/api/todo/route'
import * as waste from '@/app/api/waste/route'
export { D1OnPostgres, translateSql, rpcExecutor } from './d1-postgres'

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', Handler>>

export const routes: { pattern: RegExp; module: RouteModule; params?: string[] }[] = [
  { pattern: /^\/api\/calendar$/, module: calendar as RouteModule },
  { pattern: /^\/api\/discussions$/, module: discussions as RouteModule },
  { pattern: /^\/api\/discussions\/attachments$/, module: attachments as RouteModule },
  { pattern: /^\/api\/discussions\/media\/([^/]+)$/, module: media as unknown as RouteModule, params: ['id'] },
  { pattern: /^\/api\/inbox$/, module: inbox as RouteModule },
  { pattern: /^\/api\/planner$/, module: planner as RouteModule },
  { pattern: /^\/api\/profile\/unlock$/, module: unlock as RouteModule },
  { pattern: /^\/api\/push\/daily$/, module: daily as RouteModule },
  { pattern: /^\/api\/push\/subscription$/, module: subscription as RouteModule },
  { pattern: /^\/api\/shopping$/, module: shopping as RouteModule },
  { pattern: /^\/api\/todo$/, module: todo as RouteModule },
  { pattern: /^\/api\/waste$/, module: waste as RouteModule },
]
