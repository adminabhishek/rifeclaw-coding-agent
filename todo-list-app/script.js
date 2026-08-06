const form = document.querySelector("#todo-form");
const input = document.querySelector("#todo-input");
const list = document.querySelector("#todo-list");

const STORAGE_KEY = "rifeclaw.todos";

function loadTodos() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveTodos(todos) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

function renderTodos() {
  const todos = loadTodos();
  list.innerHTML = "";

  for (const todo of todos) {
    const item = document.createElement("li");
    if (todo.completed) item.classList.add("completed");

    const label = document.createElement("span");
    label.textContent = todo.text;
    label.addEventListener("click", () => {
      todo.completed = !todo.completed;
      saveTodos(todos);
      renderTodos();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      saveTodos(todos.filter((entry) => entry.id !== todo.id));
      renderTodos();
    });

    item.append(label, remove);
    list.append(item);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  const todos = loadTodos();
  todos.push({
    id: crypto.randomUUID(),
    text,
    completed: false,
  });
  saveTodos(todos);
  input.value = "";
  renderTodos();
});

renderTodos();
