// Example programs shown in the dropdown.
const EXAMPLES = {
"Loop & list": `numbers = []
for i in range(5):
    numbers.append(i * i)

total = 0
for n in numbers:
    total += n
print("squares:", numbers)
print("sum:", total)`,
"Aliasing (shared reference)": `a = [1, 2, 3]
b = a          # same object!
c = a[:]       # a copy
b.append(4)
print(a, c)
a = "new"
print(b)`,
"Recursion: factorial": `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

result = factorial(4)
print(result)`,
"Fibonacci (while)": `a, b = 0, 1
seq = []
while len(seq) < 10:
    seq.append(a)
    a, b = b, a + b
print(seq)`,
"Bubble sort": `data = [5, 2, 9, 1, 7]
n = len(data)
for i in range(n):
    for j in range(n - i - 1):
        if data[j] > data[j + 1]:
            data[j], data[j + 1] = data[j + 1], data[j]
print(data)`,
"Dict: word count": `text = "the cat and the hat and the bat"
counts = {}
for word in text.split():
    counts[word] = counts.get(word, 0) + 1
print(counts)`,
"Class & linked list": `class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next

head = None
for v in [3, 2, 1]:
    head = Node(v, head)

cur = head
while cur:
    print(cur.value)
    cur = cur.next`,
"Binary search": `def search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

print(search([1, 3, 5, 7, 9, 11], 7))`,
"Input example": `name = input("Name? ")
age = int(input("Age? "))
print(f"Hello {name}, next year you are {age + 1}")`,
"Nested loops: multiplication table": `rows = []
for i in range(1, 4):
    row = []
    for j in range(1, 5):
        row.append(i * j)
    rows.append(row)
print(rows)`,
"2D list (grid)": `grid = [[0] * 3 for _ in range(3)]
for r in range(3):
    for c in range(3):
        grid[r][c] = r * 3 + c
total = 0
for row in grid:
    for value in row:
        total += value
print(grid, total)`,
"Nested functions & closure": `def make_counter(start):
    count = start
    def step(by):
        nonlocal count
        count += by
        return count
    return step

counter = make_counter(10)
print(counter(1), counter(5), counter(2))`,
"Recursion: flatten nested list": `def flatten(items):
    result = []
    for item in items:
        if isinstance(item, list):
            result.extend(flatten(item))
        else:
            result.append(item)
    return result

print(flatten([1, [2, [3, 4]], 5]))`,
"Recursion: Tower of Hanoi": `def hanoi(n, source, target, spare, moves):
    if n == 0:
        return
    hanoi(n - 1, source, spare, target, moves)
    moves.append(source + " -> " + target)
    hanoi(n - 1, spare, target, source, moves)

moves = []
hanoi(3, "A", "C", "B", moves)
print(len(moves), moves)`
};
