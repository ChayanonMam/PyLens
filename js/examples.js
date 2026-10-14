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
print(f"Hello {name}, next year you are {age + 1}")`
};
