import { postQueryOptions } from "@/queries/posts";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PostView } from "@/components/PostView";

export const Route = createFileRoute("/posts/$postId")({
  loader: ({ context: { queryClient }, params: { postId } }) => {
    return queryClient.ensureQueryData(postQueryOptions(postId));
  },
  component: RouteComponent,
});

function RouteComponent() {
  const postId = Route.useParams().postId;
  const { data: post } = useSuspenseQuery(postQueryOptions(postId));
  return (
    <div className="p-4">
      <Link to="/posts" className="text-sm text-blue-500 underline mb-2 block">Back to posts</Link>
      <PostView post={post} showJson={true} />
    </div>
  );
}
