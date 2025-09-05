// Test script to verify thread fix
console.log('Testing thread fix...')

// Mock thread structure to simulate the issue
const mockEvents = [
  { id: 'root123', content: 'Root post', tags: [] },
  { id: 'reply1', content: 'Reply to root', tags: [['e', 'root123', '', 'reply']] },
  { id: 'reply2', content: 'Another reply to root', tags: [['e', 'root123', '', 'reply']] },
  { id: 'subreply1', content: 'Reply to reply1', tags: [['e', 'reply1', '', 'reply']] }
]

// Simulate the fixed logic
function testBuildThreadTree(events, rootId) {
  const nodes = new Map()
  
  // Create nodes for all events
  for (const event of events) {
    const eventId = event.id
    if (!eventId) continue

    const parents = event.tags
      .filter(tag => Array.isArray(tag) && tag[0] === 'e' && tag[3] === 'reply')
      .map(tag => tag[1])
    
    let parentId = parents.length > 0 ? parents[0] : undefined
    
    // For direct replies to root, keep the root as parent
    // Only set to undefined if this IS the root event
    if (eventId === rootId) {
      parentId = undefined
    }

    const node = {
      event,
      id: eventId,
      parentId,
      rootId,
      children: [],
      depth: 0
    }

    nodes.set(eventId, node)
  }
  
  // Build parent-child relationships
  const tree = []
  const rootNode = nodes.get(rootId)
  
  if (rootNode) {
    rootNode.depth = 0
    tree.push(rootNode)
    
    // Find children recursively
    function buildChildren(parent, currentDepth) {
      for (const node of Array.from(nodes.values())) {
        if (node.parentId === parent.id && node.id !== parent.id) {
          node.depth = currentDepth + 1
          parent.children.push(node)
          buildChildren(node, node.depth)
        }
      }
    }
    
    buildChildren(rootNode, 0)
  }
  
  return { nodes, tree, rootId }
}

// Test the fix
const result = testBuildThreadTree(mockEvents, 'root123')

console.log('Total nodes in map:', result.nodes.size)
console.log('Tree structure:')
console.log('Root node:', result.tree[0]?.id)
console.log('Root children count:', result.tree[0]?.children.length)
console.log('Root children:', result.tree[0]?.children.map(c => c.id))

if (result.tree[0]?.children.length === 2) {
  console.log('✓ Fix successful: Root has 2 direct children as expected')
} else {
  console.log('✗ Fix failed: Root should have 2 direct children')
}

// Check subreply
const reply1Node = result.tree[0]?.children.find(c => c.id === 'reply1')
if (reply1Node && reply1Node.children.length === 1) {
  console.log('✓ Subreply structure correct')
} else {
  console.log('✗ Subreply structure incorrect')
}