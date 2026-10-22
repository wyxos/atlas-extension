import { artifactFingerprint, git } from './repository.mjs';
import { documentationOnlyChanges } from './documentation.mjs';

export function buildPlan(repo, head, previous) {
  const tree = git(repo.root, ['rev-parse', `${head}^{tree}`]);
  const fingerprint = artifactFingerprint(repo.artifact);
  const documentationOnly = previous?.tree !== tree && documentationOnlyChanges(repo.root, previous?.tree, tree);
  const needed = !previous || (previous.tree !== tree && !documentationOnly)
    || !fingerprint || previous.artifact !== fingerprint;
  return { tree, needed, documentationOnly };
}
