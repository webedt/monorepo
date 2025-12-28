/**
 * Tests for CRDT Undo Operations
 *
 * Verifies that undo operations are correctly implemented as new forward
 * operations that apply inverse changes, rather than reverting history.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  DocumentStateManager,
  UndoManager,
  generateInverseOperation,
  generateInversePayload,
  generateOperationId,
  incrementTimestamp,
  incrementVectorClock,
  isInverseOf,
  canCollapseOperations,
  applyPayloadToContent,
} from '../../src/crdt/index.js';

import type {
  Operation,
  OperationPayload,
  LamportTimestamp,
  VectorClock,
} from '../../src/crdt/index.js';

/**
 * Helper to create a basic operation
 */
function createOperation(
  payload: OperationPayload,
  replicaId: string = 'replica-1',
  counter: number = 1
): Operation {
  return {
    metadata: {
      id: generateOperationId(),
      timestamp: { counter, replicaId },
      vectorClock: { [replicaId]: counter },
      isInverse: false,
    },
    payload,
  };
}

describe('CRDT Inverse Generator', () => {
  describe('Text Operations', () => {
    it('should generate inverse for text insert (becomes text delete)', () => {
      const payload: OperationPayload = {
        type: 'text_insert',
        path: 'file.txt',
        position: 5,
        content: 'Hello',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'text_delete');
      assert.strictEqual((result.inverse as any).path, 'file.txt');
      assert.strictEqual((result.inverse as any).position, 5);
      assert.strictEqual((result.inverse as any).length, 5);
      assert.strictEqual((result.inverse as any).deletedContent, 'Hello');
    });

    it('should generate inverse for text delete (becomes text insert)', () => {
      const payload: OperationPayload = {
        type: 'text_delete',
        path: 'file.txt',
        position: 10,
        length: 7,
        deletedContent: 'removed',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'text_insert');
      assert.strictEqual((result.inverse as any).path, 'file.txt');
      assert.strictEqual((result.inverse as any).position, 10);
      assert.strictEqual((result.inverse as any).content, 'removed');
    });

    it('should generate inverse for text replace (swaps old/new content)', () => {
      const payload: OperationPayload = {
        type: 'text_replace',
        path: 'file.txt',
        position: 0,
        oldContent: 'foo',
        newContent: 'bar',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'text_replace');
      assert.strictEqual((result.inverse as any).oldContent, 'bar');
      assert.strictEqual((result.inverse as any).newContent, 'foo');
    });
  });

  describe('File Operations', () => {
    it('should generate inverse for file create (becomes file delete)', () => {
      const payload: OperationPayload = {
        type: 'file_create',
        path: 'new-file.txt',
        content: 'initial content',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'file_delete');
      assert.strictEqual((result.inverse as any).path, 'new-file.txt');
      assert.strictEqual((result.inverse as any).content, 'initial content');
    });

    it('should generate inverse for file delete (becomes file create)', () => {
      const payload: OperationPayload = {
        type: 'file_delete',
        path: 'deleted-file.txt',
        content: 'was here',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'file_create');
      assert.strictEqual((result.inverse as any).path, 'deleted-file.txt');
      assert.strictEqual((result.inverse as any).content, 'was here');
    });

    it('should generate inverse for file rename (swaps paths)', () => {
      const payload: OperationPayload = {
        type: 'file_rename',
        oldPath: 'old-name.txt',
        newPath: 'new-name.txt',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'file_rename');
      assert.strictEqual((result.inverse as any).oldPath, 'new-name.txt');
      assert.strictEqual((result.inverse as any).newPath, 'old-name.txt');
    });
  });

  describe('Property Operations', () => {
    it('should generate inverse for property set (restores old value)', () => {
      const payload: OperationPayload = {
        type: 'property_set',
        path: 'config.json',
        key: 'theme',
        oldValue: 'light',
        newValue: 'dark',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'property_set');
      assert.strictEqual((result.inverse as any).oldValue, 'dark');
      assert.strictEqual((result.inverse as any).newValue, 'light');
    });

    it('should generate property delete as inverse when old value was undefined', () => {
      const payload: OperationPayload = {
        type: 'property_set',
        path: 'config.json',
        key: 'newKey',
        oldValue: undefined,
        newValue: 'value',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'property_delete');
      assert.strictEqual((result.inverse as any).key, 'newKey');
      assert.strictEqual((result.inverse as any).deletedValue, 'value');
    });

    it('should generate inverse for property delete (becomes property set)', () => {
      const payload: OperationPayload = {
        type: 'property_delete',
        path: 'config.json',
        key: 'removed',
        deletedValue: 'was here',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'property_set');
      assert.strictEqual((result.inverse as any).key, 'removed');
      assert.strictEqual((result.inverse as any).newValue, 'was here');
    });
  });

  describe('Array Operations', () => {
    it('should generate inverse for array insert (becomes array delete)', () => {
      const payload: OperationPayload = {
        type: 'array_insert',
        path: 'list.json',
        index: 2,
        items: ['a', 'b', 'c'],
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'array_delete');
      assert.strictEqual((result.inverse as any).index, 2);
      assert.strictEqual((result.inverse as any).count, 3);
      assert.deepStrictEqual((result.inverse as any).deletedItems, ['a', 'b', 'c']);
    });

    it('should generate inverse for array delete (becomes array insert)', () => {
      const payload: OperationPayload = {
        type: 'array_delete',
        path: 'list.json',
        index: 5,
        count: 2,
        deletedItems: ['x', 'y'],
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'array_insert');
      assert.strictEqual((result.inverse as any).index, 5);
      assert.deepStrictEqual((result.inverse as any).items, ['x', 'y']);
    });

    it('should generate inverse for array move (swaps indices)', () => {
      const payload: OperationPayload = {
        type: 'array_move',
        path: 'list.json',
        fromIndex: 2,
        toIndex: 7,
        count: 3,
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'array_move');
      assert.strictEqual((result.inverse as any).fromIndex, 7);
      assert.strictEqual((result.inverse as any).toIndex, 2);
      assert.strictEqual((result.inverse as any).count, 3);
    });
  });

  describe('Composite Operations', () => {
    it('should generate inverse for composite operation (reverse order)', () => {
      const payload: OperationPayload = {
        type: 'composite',
        operations: [
          { type: 'text_insert', path: 'file.txt', position: 0, content: 'A' },
          { type: 'text_insert', path: 'file.txt', position: 1, content: 'B' },
          { type: 'text_insert', path: 'file.txt', position: 2, content: 'C' },
        ],
        description: 'Insert ABC',
      };

      const result = generateInversePayload(payload);

      assert.strictEqual(result.inverse.type, 'composite');
      const ops = (result.inverse as any).operations;
      assert.strictEqual(ops.length, 3);
      // Should be in reverse order
      assert.strictEqual(ops[0].type, 'text_delete');
      assert.strictEqual(ops[0].position, 2);
      assert.strictEqual(ops[1].position, 1);
      assert.strictEqual(ops[2].position, 0);
    });
  });

  describe('Full Operation Generation', () => {
    it('should generate complete inverse operation with new metadata', () => {
      const original = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'Hello',
      });

      const context = {
        replicaId: 'replica-1',
        currentTimestamp: { counter: 1, replicaId: 'replica-1' },
        currentVectorClock: { 'replica-1': 1 },
      };

      const result = generateInverseOperation(original, context);

      // Check metadata
      assert.ok(result.inverseOperation.metadata.id);
      assert.notStrictEqual(result.inverseOperation.metadata.id, original.metadata.id);
      assert.strictEqual(result.inverseOperation.metadata.isInverse, true);
      assert.strictEqual(result.inverseOperation.metadata.inverseOf, original.metadata.id);

      // Check timestamp was incremented
      assert.strictEqual(result.newTimestamp.counter, 2);

      // Check vector clock was incremented
      assert.strictEqual(result.newVectorClock['replica-1'], 2);

      // Check payload is correct inverse
      assert.strictEqual(result.inverseOperation.payload.type, 'text_delete');
    });

    it('should mark undo operations with undoOf when undoing original', () => {
      const original = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'Hello',
      });
      original.metadata.isInverse = false;

      const context = {
        replicaId: 'replica-1',
        currentTimestamp: { counter: 1, replicaId: 'replica-1' },
        currentVectorClock: { 'replica-1': 1 },
      };

      const result = generateInverseOperation(original, context);

      assert.strictEqual(result.inverseOperation.metadata.undoOf, original.metadata.id);
      assert.strictEqual(result.inverseOperation.metadata.redoOf, undefined);
    });

    it('should mark redo operations with redoOf when undoing an inverse', () => {
      const inverseOp = createOperation({
        type: 'text_delete',
        path: 'test.txt',
        position: 0,
        length: 5,
        deletedContent: 'Hello',
      });
      inverseOp.metadata.isInverse = true;

      const context = {
        replicaId: 'replica-1',
        currentTimestamp: { counter: 2, replicaId: 'replica-1' },
        currentVectorClock: { 'replica-1': 2 },
      };

      const result = generateInverseOperation(inverseOp, context);

      assert.strictEqual(result.inverseOperation.metadata.redoOf, inverseOp.metadata.id);
      assert.strictEqual(result.inverseOperation.metadata.undoOf, undefined);
    });
  });
});

describe('isInverseOf Detection', () => {
  it('should detect text insert/delete pairs', () => {
    const insert = createOperation({
      type: 'text_insert',
      path: 'file.txt',
      position: 5,
      content: 'Hello',
    });

    const del = createOperation({
      type: 'text_delete',
      path: 'file.txt',
      position: 5,
      length: 5,
      deletedContent: 'Hello',
    });

    assert.strictEqual(isInverseOf(insert, del), true);
    assert.strictEqual(isInverseOf(del, insert), true);
  });

  it('should detect file create/delete pairs', () => {
    const create = createOperation({
      type: 'file_create',
      path: 'new.txt',
      content: 'content',
    });

    const del = createOperation({
      type: 'file_delete',
      path: 'new.txt',
      content: 'content',
    });

    assert.strictEqual(isInverseOf(create, del), true);
  });

  it('should not detect non-inverse pairs', () => {
    const insert1 = createOperation({
      type: 'text_insert',
      path: 'file.txt',
      position: 0,
      content: 'A',
    });

    const insert2 = createOperation({
      type: 'text_insert',
      path: 'file.txt',
      position: 1,
      content: 'B',
    });

    assert.strictEqual(isInverseOf(insert1, insert2), false);
  });
});

describe('Operation Collapsing', () => {
  it('should detect consecutive text inserts that can be collapsed', () => {
    const insert1 = createOperation({
      type: 'text_insert',
      path: 'file.txt',
      position: 0,
      content: 'Hello',
    });

    const insert2 = createOperation({
      type: 'text_insert',
      path: 'file.txt',
      position: 5,
      content: ' World',
    });

    assert.strictEqual(canCollapseOperations(insert1, insert2), true);
  });

  it('should not collapse non-consecutive inserts', () => {
    const insert1 = createOperation({
      type: 'text_insert',
      path: 'file.txt',
      position: 0,
      content: 'Hello',
    });

    const insert2 = createOperation({
      type: 'text_insert',
      path: 'file.txt',
      position: 10, // Gap between inserts
      content: ' World',
    });

    assert.strictEqual(canCollapseOperations(insert1, insert2), false);
  });

  it('should not collapse operations on different paths', () => {
    const insert1 = createOperation({
      type: 'text_insert',
      path: 'file1.txt',
      position: 0,
      content: 'A',
    });

    const insert2 = createOperation({
      type: 'text_insert',
      path: 'file2.txt',
      position: 1,
      content: 'B',
    });

    assert.strictEqual(canCollapseOperations(insert1, insert2), false);
  });
});

describe('Document State Application', () => {
  it('should correctly apply text insert', () => {
    const content = 'Hello World';
    const payload: OperationPayload = {
      type: 'text_insert',
      path: 'test.txt',
      position: 6,
      content: 'Beautiful ',
    };

    const result = applyPayloadToContent(content, payload);

    assert.strictEqual(result, 'Hello Beautiful World');
  });

  it('should correctly apply text delete', () => {
    const content = 'Hello Beautiful World';
    const payload: OperationPayload = {
      type: 'text_delete',
      path: 'test.txt',
      position: 6,
      length: 10,
      deletedContent: 'Beautiful ',
    };

    const result = applyPayloadToContent(content, payload);

    assert.strictEqual(result, 'Hello World');
  });

  it('should correctly apply text replace', () => {
    const content = 'Hello World';
    const payload: OperationPayload = {
      type: 'text_replace',
      path: 'test.txt',
      position: 6,
      oldContent: 'World',
      newContent: 'Universe',
    };

    const result = applyPayloadToContent(content, payload);

    assert.strictEqual(result, 'Hello Universe');
  });

  it('should handle edge cases: insert at beginning', () => {
    const content = 'World';
    const payload: OperationPayload = {
      type: 'text_insert',
      path: 'test.txt',
      position: 0,
      content: 'Hello ',
    };

    const result = applyPayloadToContent(content, payload);

    assert.strictEqual(result, 'Hello World');
  });

  it('should handle edge cases: insert at end', () => {
    const content = 'Hello';
    const payload: OperationPayload = {
      type: 'text_insert',
      path: 'test.txt',
      position: 5,
      content: ' World',
    };

    const result = applyPayloadToContent(content, payload);

    assert.strictEqual(result, 'Hello World');
  });
});

describe('Undo Manager', () => {
  let docManager: DocumentStateManager;
  let undoManager: UndoManager;

  beforeEach(() => {
    docManager = new DocumentStateManager();
    docManager.setDocument('test.txt', 'Hello World');
    undoManager = new UndoManager('replica-1', docManager);
  });

  describe('Recording Operations', () => {
    it('should record operations for undo', () => {
      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 5,
        content: ' Beautiful',
      });

      docManager.applyOperation(op);
      undoManager.recordOperation(op);

      assert.strictEqual(undoManager.canUndo(), true);
      assert.strictEqual(undoManager.getUndoCount(), 1);
    });

    it('should record inverse operations (they are forward ops in CRDT model)', () => {
      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 5,
        content: ' Beautiful',
      });
      op.metadata.isInverse = true;

      docManager.applyOperation(op);
      undoManager.recordOperation(op);

      // Inverse operations ARE recorded because they're forward operations
      // that can be undone by other replicas in collaborative editing
      assert.strictEqual(undoManager.canUndo(), true);
    });

    it('should clear redo stack when new operation is recorded', () => {
      // First, create an undo entry
      const op1 = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'A',
      });
      docManager.applyOperation(op1);
      undoManager.recordOperation(op1);

      // Undo it
      undoManager.undo();
      assert.strictEqual(undoManager.canRedo(), true);

      // Record new operation
      const op2 = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'B',
      }, 'replica-1', 3);
      docManager.applyOperation(op2);
      undoManager.recordOperation(op2);

      // Redo should be cleared
      assert.strictEqual(undoManager.canRedo(), false);
    });
  });

  describe('Performing Undo', () => {
    it('should return a forward operation when undoing', () => {
      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 5,
        content: ' Beautiful',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op);

      const undoOp = undoManager.undo();

      assert.ok(undoOp);
      assert.strictEqual(undoOp.metadata.isInverse, true);
      assert.strictEqual(undoOp.metadata.inverseOf, op.metadata.id);
      assert.strictEqual(undoOp.payload.type, 'text_delete');
    });

    it('should update document state when undoing', () => {
      // Initial: "Hello World"
      const op = createOperation({
        type: 'text_replace',
        path: 'test.txt',
        position: 6,
        oldContent: 'World',
        newContent: 'Universe',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op);

      // After op: "Hello Universe"
      assert.strictEqual(docManager.getDocument('test.txt').content, 'Hello Universe');

      undoManager.undo();

      // After undo: "Hello World"
      assert.strictEqual(docManager.getDocument('test.txt').content, 'Hello World');
    });

    it('should return null when undo stack is empty', () => {
      const undoOp = undoManager.undo();

      assert.strictEqual(undoOp, null);
    });

    it('should enable redo after undo', () => {
      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'X',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op);

      assert.strictEqual(undoManager.canRedo(), false);

      undoManager.undo();

      assert.strictEqual(undoManager.canRedo(), true);
    });
  });

  describe('Performing Redo', () => {
    it('should return a forward operation when redoing', () => {
      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'X',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op);
      undoManager.undo();

      const redoOp = undoManager.redo();

      assert.ok(redoOp);
      assert.strictEqual(redoOp.metadata.isInverse, true);
      // The redo operation is the inverse of the undo (which brings back the original)
      assert.strictEqual(redoOp.payload.type, 'text_insert');
    });

    it('should restore document state when redoing', () => {
      docManager.setDocument('test.txt', 'Original');

      const op = createOperation({
        type: 'text_replace',
        path: 'test.txt',
        position: 0,
        oldContent: 'Original',
        newContent: 'Modified',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op);

      undoManager.undo();
      assert.strictEqual(docManager.getDocument('test.txt').content, 'Original');

      undoManager.redo();
      assert.strictEqual(docManager.getDocument('test.txt').content, 'Modified');
    });

    it('should return null when redo stack is empty', () => {
      const redoOp = undoManager.redo();

      assert.strictEqual(redoOp, null);
    });
  });

  describe('Multiple Undo/Redo', () => {
    it('should handle multiple undos in sequence', () => {
      docManager.setDocument('test.txt', '');

      // Insert A, B, C
      const ops = ['A', 'B', 'C'].map((char, i) => {
        const op = createOperation({
          type: 'text_insert',
          path: 'test.txt',
          position: i,
          content: char,
        }, 'replica-1', i + 1);
        docManager.applyOperation(op);
        undoManager.recordOperation(op);
        return op;
      });

      assert.strictEqual(docManager.getDocument('test.txt').content, 'ABC');

      // Undo C
      undoManager.undo();
      assert.strictEqual(docManager.getDocument('test.txt').content, 'AB');

      // Undo B
      undoManager.undo();
      assert.strictEqual(docManager.getDocument('test.txt').content, 'A');

      // Undo A
      undoManager.undo();
      assert.strictEqual(docManager.getDocument('test.txt').content, '');

      assert.strictEqual(undoManager.canUndo(), false);
      assert.strictEqual(undoManager.getRedoCount(), 3);
    });

    it('should handle alternating undo/redo', () => {
      docManager.setDocument('test.txt', 'Base');

      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 4,
        content: '+Extra',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op);

      assert.strictEqual(docManager.getDocument('test.txt').content, 'Base+Extra');

      undoManager.undo();
      assert.strictEqual(docManager.getDocument('test.txt').content, 'Base');

      undoManager.redo();
      assert.strictEqual(docManager.getDocument('test.txt').content, 'Base+Extra');

      undoManager.undo();
      assert.strictEqual(docManager.getDocument('test.txt').content, 'Base');
    });
  });

  describe('State Change Events', () => {
    it('should emit events on undo', () => {
      const events: any[] = [];
      undoManager.subscribe((event) => events.push(event));

      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'X',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op);
      undoManager.undo();

      const undoEvent = events.find((e) => e.type === 'undo');
      assert.ok(undoEvent);
      assert.strictEqual(undoEvent.canRedo, true);
    });

    it('should emit events on redo', () => {
      const events: any[] = [];
      undoManager.subscribe((event) => events.push(event));

      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'X',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op);
      undoManager.undo();
      undoManager.redo();

      const redoEvent = events.find((e) => e.type === 'redo');
      assert.ok(redoEvent);
    });
  });

  describe('Stack Size Limits', () => {
    it('should limit undo stack size', () => {
      const smallUndoManager = new UndoManager('replica-1', docManager, {
        maxUndoStackSize: 3,
      });

      // Add 5 operations
      for (let i = 0; i < 5; i++) {
        const op = createOperation({
          type: 'text_insert',
          path: 'test.txt',
          position: i,
          content: String(i),
        }, 'replica-1', i + 1);
        docManager.applyOperation(op);
        smallUndoManager.recordOperation(op);
      }

      // Should only have 3 in stack
      assert.strictEqual(smallUndoManager.getUndoCount(), 3);
    });
  });

  describe('Descriptions', () => {
    it('should provide undo description', () => {
      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'Hello',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op, 'Type greeting');

      assert.strictEqual(undoManager.getUndoDescription(), 'Type greeting');
    });

    it('should provide redo description', () => {
      const op = createOperation({
        type: 'text_insert',
        path: 'test.txt',
        position: 0,
        content: 'Hello',
      });
      docManager.applyOperation(op);
      undoManager.recordOperation(op, 'Type greeting');
      undoManager.undo();

      const redoDesc = undoManager.getRedoDescription();
      assert.ok(redoDesc);
      assert.ok(redoDesc.includes('Redo'));
    });
  });
});

describe('CRDT Undo as Forward Operations - Integration', () => {
  it('should produce operations that can be replicated to other nodes', () => {
    // Node A
    const docManagerA = new DocumentStateManager();
    docManagerA.setDocument('shared.txt', 'Initial');
    const undoManagerA = new UndoManager('node-a', docManagerA);

    // Node B (simulated)
    const docManagerB = new DocumentStateManager();
    docManagerB.setDocument('shared.txt', 'Initial');

    // Node A makes a change
    const insertOp = createOperation({
      type: 'text_insert',
      path: 'shared.txt',
      position: 7,
      content: ' Text',
    }, 'node-a', 1);
    docManagerA.applyOperation(insertOp);
    undoManagerA.recordOperation(insertOp);

    // Replicate to Node B
    docManagerB.applyOperation(insertOp);

    assert.strictEqual(docManagerA.getDocument('shared.txt').content, 'Initial Text');
    assert.strictEqual(docManagerB.getDocument('shared.txt').content, 'Initial Text');

    // Node A undoes - this produces a NEW forward operation
    const undoOp = undoManagerA.undo()!;

    // The undo operation IS a forward operation
    assert.strictEqual(undoOp.metadata.isInverse, true);
    assert.strictEqual(undoOp.payload.type, 'text_delete');

    // Replicate the undo operation to Node B
    docManagerB.applyOperation(undoOp);

    // Both nodes should now be in sync
    assert.strictEqual(docManagerA.getDocument('shared.txt').content, 'Initial');
    assert.strictEqual(docManagerB.getDocument('shared.txt').content, 'Initial');
  });

  it('should allow undo operations from one node to be undone by another', () => {
    // This tests that undo operations truly are just regular forward operations
    const docManagerA = new DocumentStateManager();
    docManagerA.setDocument('shared.txt', 'Base');
    const undoManagerA = new UndoManager('node-a', docManagerA);

    const docManagerB = new DocumentStateManager();
    docManagerB.setDocument('shared.txt', 'Base');
    const undoManagerB = new UndoManager('node-b', docManagerB);

    // Node A inserts
    const insertOp = createOperation({
      type: 'text_insert',
      path: 'shared.txt',
      position: 4,
      content: '+Added',
    }, 'node-a', 1);

    docManagerA.applyOperation(insertOp);
    undoManagerA.recordOperation(insertOp);
    docManagerB.applyOperation(insertOp);
    undoManagerB.recordOperation(insertOp);

    // Node A undoes
    const undoOpFromA = undoManagerA.undo()!;
    docManagerB.applyOperation(undoOpFromA);
    // Node B also records this undo operation (it's a forward operation!)
    undoManagerB.recordOperation(undoOpFromA);

    assert.strictEqual(docManagerB.getDocument('shared.txt').content, 'Base');

    // Node B can now undo the undo (redo the original)!
    const undoTheUndoFromB = undoManagerB.undo()!;
    docManagerA.applyOperation(undoTheUndoFromB);

    // Both should now have the text restored
    assert.strictEqual(docManagerA.getDocument('shared.txt').content, 'Base+Added');
    assert.strictEqual(docManagerB.getDocument('shared.txt').content, 'Base+Added');
  });
});
