// Regression cases for the Python tracer (js/tracer.js).
// Each case runs real code through the same worker the app uses, then asserts on the JSON trace.

const distinctCalls = r => {
  const seen = new Set();
  r.steps.forEach(st => st.stack.forEach((f, i) => { if (i > 0) seen.add(f.cid); }));
  return seen.size;
};
const maxDepth = r => Math.max(...r.steps.map(s => s.stack.length));
const lastVars = r => {
  const st = r.steps[r.steps.length - 1];
  const g = st.stack[0], o = {};
  g.vars.forEach(([n, v]) => { o[n] = v.k === 'p' ? v.v : '#' + v.id; });
  return {vars: o, heap: st.heap};
};

const CASES = [
  {
    name: 'print and arithmetic',
    code: `print(1 + 1)`,
    check(r, t) {
      t.eq(r.out, '2\n', 'output');
      t.eq(r.error, null, 'no error');
      t.ok(r.steps.length >= 2, 'has steps');
    }
  },
  {
    name: 'loop builds a list on the heap',
    code: `nums = []
for i in range(3):
    nums.append(i * i)
print(nums)`,
    check(r, t) {
      t.eq(r.out, '[0, 1, 4]\n', 'output');
      const {vars, heap} = lastVars(r);
      t.eq(vars.i, '2', 'loop variable');
      const lst = heap[vars.nums.slice(1)];
      t.ok(lst && lst.t === 'list' && lst.items.length === 3, 'list on heap with 3 items');
    }
  },
  {
    name: 'recursion depth and unique calls (factorial)',
    code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
print(factorial(4))`,
    check(r, t) {
      t.eq(r.out, '24\n', 'output');
      t.eq(maxDepth(r), 5, 'max stack depth');
      t.eq(distinctCalls(r), 4, 'distinct calls');
    }
  },
  {
    name: 'sibling calls on one line are counted (fib)',
    code: `def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
print(fib(4))`,
    check(r, t) {
      t.eq(r.out, '3\n', 'output');
      t.eq(distinctCalls(r), 9, 'fib(4) makes 9 calls');
    }
  },
  {
    name: 'return value is recorded on the return step',
    code: `def add(a, b):
    return a + b
x = add(2, 3)`,
    check(r, t) {
      const ret = r.steps.find(s => s.ev === 'return' && s.fn === 'add');
      t.ok(ret && ret.ret && ret.ret.v === '5', 'return step carries 5');
    }
  },
  {
    name: 'IndexError reports line and message',
    code: `a = [1, 2, 3]
print(a[0])
print(a[5])`,
    check(r, t) {
      t.ok(r.error && r.error.msg.startsWith('IndexError'), 'IndexError');
      t.eq(r.error.line, 3, 'error line');
      t.eq(r.out, '1\n', 'output before the error is kept');
    }
  },
  {
    name: 'ZeroDivisionError',
    code: `x = 0
y = 10 / x`,
    check(r, t) {
      t.ok(r.error && r.error.msg.startsWith('ZeroDivisionError'), 'ZeroDivisionError');
      t.eq(r.error.line, 2, 'error line');
    }
  },
  {
    name: 'SyntaxError gives no steps and a message',
    code: `x = (`,
    check(r, t) {
      t.eq(r.steps.length, 0, 'no steps');
      t.ok(r.error && r.error.msg.startsWith('SyntaxError'), 'SyntaxError');
    }
  },
  {
    name: 'input() pauses when no stdin is given',
    code: `name = input("Name? ")
print("Hi", name)`,
    check(r, t) {
      t.eq(r.needs_input, 'Name? ', 'asks for input with the prompt');
      t.eq(r.error, null, 'not an error');
    }
  },
  {
    name: 'input() consumes provided stdin',
    code: `name = input("Name? ")
age = int(input("Age? "))
print(name, age + 1)`,
    stdin: 'Somchai\n20',
    check(r, t) {
      t.eq(r.needs_input, null, 'no pause');
      t.eq(r.out, 'Name? Somchai\nAge? 20\nSomchai 21\n', 'output');
      t.eq(r.inputs.length, 2, 'two inputs used');
    }
  },
  {
    name: 'bare except cannot hide a pending input()',
    code: `try:
    v = input("x? ")
except:
    v = "swallowed"
print(v)`,
    check(r, t) {
      t.eq(r.needs_input, 'x? ', 'still reported as waiting for input');
    }
  },
  {
    name: 'generator yields are labelled',
    code: `def gen():
    yield 1
    yield 2
for v in gen():
    print(v)`,
    check(r, t) {
      const y = r.steps.filter(s => s.ev === 'yield').length;
      t.eq(y, 2, 'two yield steps');
      t.eq(r.out, '1\n2\n', 'output');
    }
  },
  {
    name: 'generator object appears on the heap',
    code: `def gen():
    yield 1
g = gen()
next(g)`,
    check(r, t) {
      const has = r.steps.some(s => Object.values(s.heap).some(o => o && o.t === 'generator'));
      t.ok(has, 'generator heap object');
    }
  },
  {
    name: 'expression breakdown rows',
    code: `nums = [1, 2, 3]
total = 0
for i in range(3):
    total += nums[i] * 2`,
    check(r, t) {
      const st = r.steps.find(s => s.line === 4 && s.ex);
      t.ok(st, 'a step with breakdown');
      const srcs = st.ex.map(x => x[0]);
      t.ok(srcs.includes('nums[i]'), 'nums[i] is shown');
      t.ok(srcs.includes('nums[i] * 2'), 'nums[i] * 2 is shown');
    }
  },
  {
    name: 'user function calls are not evaluated for the breakdown',
    code: `calls = []
def f(x):
    calls.append(x)
    return x
y = f(1) + 1`,
    check(r, t) {
      const lastv = lastVars(r);
      const lst = lastv.heap[lastv.vars.calls.slice(1)];
      t.eq(lst.items.length, 1, 'f ran exactly once (no side effects from analysis)');
    }
  },
  {
    name: 'comprehension is unrolled',
    code: `nums = [1, 2, 3]
sq = [x * x for x in nums if x > 1]`,
    check(r, t) {
      const st = r.steps.find(s => s.un);
      t.ok(st && st.un.includes('for x in nums'), 'unrolled loop text');
    }
  },
  {
    name: 'closure free variable is flagged',
    code: `def outer():
    x = 1
    def inner():
        return x
    return inner()
outer()`,
    check(r, t) {
      const st = r.steps.find(s => s.stack.length > 2);
      const inner = st.stack[st.stack.length - 1];
      t.ok(inner.free && inner.free.includes('x'), 'x is a free variable of inner');
    }
  },
  {
    name: 'global reads are listed for a function frame',
    code: `limit = 7
def f():
    return limit + 1
f()`,
    check(r, t) {
      const st = r.steps.find(s => s.stack.length > 1 && s.stack[1].glob && s.stack[1].glob.length);
      t.ok(st && st.stack[1].glob[0][0] === 'limit', 'limit listed');
    }
  },
  {
    name: 'class instance on the heap',
    code: `class P:
    def __init__(self, x):
        self.x = x
p = P(3)`,
    check(r, t) {
      const {vars, heap} = lastVars(r);
      const o = heap[vars.p.slice(1)];
      t.ok(o && o.t === 'instance' && o.cls === 'P', 'instance of P');
    }
  },
  {
    name: 'aliasing shares one heap object',
    code: `a = [1]
b = a
c = a[:]`,
    check(r, t) {
      const {vars} = lastVars(r);
      t.eq(vars.a, vars.b, 'a and b share an id');
      t.ok(vars.a !== vars.c, 'c is a different object');
    }
  },
  {
    name: 'step limit stops runaway loops',
    code: `n = 0
while True:
    n += 1`,
    max: 300,
    check(r, t) {
      t.eq(r.truncated, true, 'truncated');
      t.eq(r.steps.length, 300, 'exactly max steps recorded');
    }
  },
  {
    name: 'missing file reports FileNotFoundError',
    code: `open("nope.txt")`,
    check(r, t) {
      t.ok(r.error && r.error.msg.startsWith('FileNotFoundError'), 'FileNotFoundError');
      t.ok(r.error.msg.includes('nope.txt'), 'names the file');
    }
  },
  {
    name: 'virtual files can be read',
    code: `with open("data.txt") as f:
    print(f.read().strip())`,
    files: [['data.txt', 'hello file']],
    check(r, t) {
      t.eq(r.out, 'hello file\n', 'file content');
      t.eq(r.error, null, 'no error');
    }
  },
  {
    name: 'time.sleep is skipped',
    code: `import time
time.sleep(30)
print("done")`,
    check(r, t) {
      t.eq(r.out, 'done\n', 'finished immediately');
    }
  },
  {
    name: 'sys.exit is handled',
    code: `import sys
print("a")
sys.exit(0)
print("b")`,
    check(r, t) {
      t.eq(r.out, 'a\n', 'stops at exit');
      t.ok(r.error === null || r.error.msg.startsWith('SystemExit'), 'no crash');
    }
  },
  {
    name: 'standard library import works',
    code: `import math, json
print(math.sqrt(16), json.dumps({"a": 1}))`,
    check(r, t) {
      t.eq(r.out, '4.0 {"a": 1}\n', 'output');
    }
  },
  {
    name: 'Thai text round-trips',
    code: `s = "สวัสดี"
print(s, len(s))`,
    check(r, t) {
      t.eq(r.out, 'สวัสดี 6\n', 'output');
    }
  },
  {
    name: 'loop/if blocks and frame lines are reported',
    code: `def f(n):
    for i in range(n):
        if i > 0:
            print(i)
        else:
            print("zero")
f(2)`,
    check(r, t) {
      const kinds = r.blocks.map(b => b.k + '@' + b.l);
      t.ok(kinds.includes('for@2'), 'for loop block at line 2');
      t.ok(kinds.includes('if@3'), 'if block at line 3');
      const ifb = r.blocks.find(b => b.k === 'if');
      t.ok(ifb && ifb.bs === 4 && ifb.os === 6, 'if has body and else ranges');
      const inner = r.steps.find(s => s.stack.length === 2);
      t.ok(inner && inner.stack[0].ln === 7, 'caller frame knows its own line (7)');
    }
  },
  {
    name: 'whole-expression value is kept even when the line has many parts',
    code: `grid = [[1, 3], [2, 4]]
dp = [[1, 4], [3, 0]]
i = 1
j = 1
dp[i][j] = grid[i][j] + min(dp[i-1][j], dp[i][j-1])`,
    check(r, t) {
      const st = r.steps.find(s => s.line === 5 && s.ev === 'line');
      t.ok(st && st.rt && st.rt[1] === '7', 'root value 7 is reported (got ' + (st && st.rt && st.rt[1]) + ')');
      const srcs = st.ex.map(x => x[0]);
      t.ok(srcs.includes('grid[i][j]') && srcs.includes('dp[i-1][j]') && srcs.includes('dp[i][j-1]'), 'the three cell reads are listed');
      t.ok(!srcs.includes('grid[i]') && !srcs.includes('dp[i-1]'), 'intermediate rows are not listed');
    }
  },
  {
    name: 'matplotlib figure is captured',
    slow: true,
    code: `import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [3, 1, 2])
plt.show()`,
    check(r, t) {
      t.eq(r.error, null, 'no error');
      t.ok(r.images && r.images.length === 1 && r.images[0].img.length > 100, 'one PNG captured');
    }
  }
];
