import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/staff';
import { DeveloperError, applyLogoToPins, createDeveloper, deleteDeveloper, listDevelopers, updateDeveloper } from '@/lib/developers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Super admin → Developers: the developer directory (one logo per developer).
//   GET                      list with project counts
//   POST {name, logo?}       add
//   POST ?id=…&action=apply  put this logo on all of the developer's map projects
//   PATCH ?id=… {name?, logo?}  rename / change or remove logo
//   DELETE ?id=…             remove from the list (map projects are not touched)
// Anyone who may edit the map may manage it.
const headers = { 'Cache-Control': 'private, no-store' };
const fail = (e: unknown) => {
  if (e instanceof DeveloperError) return NextResponse.json({ error: { message: e.message } }, { status: e.status, headers });
  console.error('[admin/developers]', e);
  return NextResponse.json({ error: { message: 'Something went wrong — try again' } }, { status: 500, headers });
};
const denied = () => NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401, headers });
const body = async (req: NextRequest) => { try { return (await req.json()) as Record<string, unknown>; } catch { return {}; } };

export async function GET() {
  if (!(await hasPermission('map'))) return denied();
  try { return NextResponse.json({ data: await listDevelopers() }, { headers }); } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  if (!(await hasPermission('map'))) return denied();
  const id = req.nextUrl.searchParams.get('id');
  try {
    if (id && req.nextUrl.searchParams.get('action') === 'apply') {
      return NextResponse.json({ data: { updated: await applyLogoToPins(id) } }, { headers });
    }
    const b = await body(req);
    await createDeveloper({ name: b.name, logo: b.logo });
    return NextResponse.json({ data: { ok: true } }, { status: 201, headers });
  } catch (e) { return fail(e); }
}

export async function PATCH(req: NextRequest) {
  if (!(await hasPermission('map'))) return denied();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: { message: 'Missing id' } }, { status: 400, headers });
  try {
    const b = await body(req);
    await updateDeveloper(id, { ...('name' in b ? { name: b.name } : {}), ...('logo' in b ? { logo: b.logo } : {}) });
    return NextResponse.json({ data: { ok: true } }, { headers });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest) {
  if (!(await hasPermission('map'))) return denied();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: { message: 'Missing id' } }, { status: 400, headers });
  try { await deleteDeveloper(id); return NextResponse.json({ data: { ok: true } }, { headers }); } catch (e) { return fail(e); }
}
