type Props = { params: { locationSlug: string } };

export default function DisplayBoard({ params }: Props) {
  return (
    <main>
      <h1 className="text-2xl font-bold">Display Board: {params.locationSlug}</h1>
      <p className="text-gray-600">
        Airport-style next 5 per bay (auto-refresh)
      </p>
    </main>
  );
}