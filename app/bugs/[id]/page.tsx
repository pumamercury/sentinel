import Home from '../../page';

export default async function BugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Home bugId={id} />;
}
