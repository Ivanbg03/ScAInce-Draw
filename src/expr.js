/**
 * A small, safe expression evaluator for the function-plot type.
 *
 * It uses a tokenizer and a shunting-yard parser. It never calls eval() or the
 * Function constructor, so an expression from a WebMCP tool call cannot execute
 * arbitrary code in phase 2. This matters: a tool input is hostile input.
 */

const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10,
  sqrt: Math.sqrt, abs: Math.abs, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, atan2: Math.atan2, pow: Math.pow,
};

const CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

const OPERATORS = {
  '+': { precedence: 1, associativity: 'left', apply: (a, b) => a + b },
  '-': { precedence: 1, associativity: 'left', apply: (a, b) => a - b },
  '*': { precedence: 2, associativity: 'left', apply: (a, b) => a * b },
  '/': { precedence: 2, associativity: 'left', apply: (a, b) => a / b },
  '%': { precedence: 2, associativity: 'left', apply: (a, b) => a % b },
  '^': { precedence: 4, associativity: 'right', apply: (a, b) => a ** b },
};

// A unary minus binds tighter than * and / but looser than ^, so -x^2 reads
// as -(x^2), which is the usual mathematical convention.
const UNARY_PRECEDENCE = 3;

/**
 * Own-property lookup only.
 * A plain object inherits "constructor", "toString" and friends from
 * Object.prototype, so `'constructor' in FUNCTIONS` is true and the name would
 * slip past a whitelist. Every table lookup here uses Object.hasOwn.
 */
const owns = (table, key) => Object.hasOwn(table, key);

function tokenize(source) {
  const tokens = [];
  let index = 0;
  const text = String(source);

  while (index < text.length) {
    const char = text[index];

    if (/\s/.test(char)) { index++; continue; }

    if (/[0-9.]/.test(char)) {
      let start = index;
      while (index < text.length && /[0-9.]/.test(text[index])) index++;
      const value = Number(text.slice(start, index));
      if (Number.isNaN(value)) throw new Error(`Bad number at position ${start}.`);
      tokens.push({ kind: 'number', value });
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      let start = index;
      while (index < text.length && /[a-zA-Z0-9_]/.test(text[index])) index++;
      tokens.push({ kind: 'name', value: text.slice(start, index) });
      continue;
    }

    if (char === '(' || char === ')' || char === ',') {
      tokens.push({ kind: char });
      index++;
      continue;
    }

    if (owns(OPERATORS, char)) {
      // A minus is unary when it opens the expression or follows an operator.
      const previous = tokens[tokens.length - 1];
      const isUnary = char === '-' && (!previous
        || previous.kind === '(' || previous.kind === ','
        || previous.kind === 'operator');
      tokens.push(isUnary ? { kind: 'unary' } : { kind: 'operator', value: char });
      index++;
      continue;
    }

    throw new Error(`Unexpected character "${char}" at position ${index}.`);
  }

  return tokens;
}

function toRpn(tokens) {
  const output = [];
  const stack = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.kind === 'number' || token.kind === 'variable') {
      output.push(token);
    } else if (token.kind === 'name') {
      if (tokens[i + 1] && tokens[i + 1].kind === '(') stack.push({ kind: 'function', value: token.value });
      else output.push({ kind: 'variable', value: token.value });
    } else if (token.kind === 'unary') {
      stack.push(token);
    } else if (token.kind === 'operator') {
      const operator = OPERATORS[token.value];
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.kind !== 'operator' && top.kind !== 'unary') break;
        const topPrecedence = top.kind === 'unary'
          ? UNARY_PRECEDENCE
          : OPERATORS[top.value].precedence;
        const takes = operator.associativity === 'left'
          ? topPrecedence >= operator.precedence
          : topPrecedence > operator.precedence;
        if (!takes) break;
        output.push(stack.pop());
      }
      stack.push(token);
    } else if (token.kind === '(') {
      stack.push(token);
    } else if (token.kind === ',') {
      while (stack.length && stack[stack.length - 1].kind !== '(') output.push(stack.pop());
      if (!stack.length) throw new Error('A comma sits outside a function call.');
    } else if (token.kind === ')') {
      while (stack.length && stack[stack.length - 1].kind !== '(') output.push(stack.pop());
      if (!stack.length) throw new Error('The brackets are unbalanced.');
      stack.pop();
      if (stack.length && stack[stack.length - 1].kind === 'function') output.push(stack.pop());
      if (stack.length && stack[stack.length - 1].kind === 'unary') output.push(stack.pop());
    }
  }

  while (stack.length) {
    const token = stack.pop();
    if (token.kind === '(') throw new Error('The brackets are unbalanced.');
    output.push(token);
  }

  return output;
}

/**
 * Compiles an expression to a function of one or more variables.
 *
 * `variables` is a name or a list of names. The returned function takes the
 * values in that order: compile('u*v', ['u', 'v']).fn(2, 3) is 6.
 * Returns { fn, error }. fn(...) returns a number or NaN.
 */
export function compile(source, variables = 'x') {
  const names = [].concat(variables);
  let rpn;
  try {
    rpn = toRpn(tokenize(source));
  } catch (error) {
    return { fn: null, error: error.message };
  }

  // Check the names before the first call, so the UI can show the mistake.
  for (const token of rpn) {
    if (token.kind === 'function' && !owns(FUNCTIONS, token.value)) {
      return { fn: null, error: `Unknown function "${token.value}".` };
    }
    if (token.kind === 'variable' && !names.includes(token.value) && !owns(CONSTANTS, token.value)) {
      return { fn: null, error: `Unknown name "${token.value}".` };
    }
  }

  const fn = (...inputs) => {
    const stack = [];
    for (const token of rpn) {
      if (token.kind === 'number') { stack.push(token.value); continue; }
      if (token.kind === 'variable') {
        const slot = names.indexOf(token.value);
        stack.push(slot === -1 ? CONSTANTS[token.value] : inputs[slot]);
        continue;
      }
      if (token.kind === 'unary') { stack.push(-stack.pop()); continue; }
      if (token.kind === 'operator') {
        const right = stack.pop();
        const left = stack.pop();
        stack.push(OPERATORS[token.value].apply(left, right));
        continue;
      }
      if (token.kind === 'function') {
        const target = FUNCTIONS[token.value];
        const args = stack.splice(stack.length - target.length, target.length);
        stack.push(target(...args));
      }
    }
    const result = stack.pop();
    return typeof result === 'number' ? result : NaN;
  };

  // One trial call catches a shape error such as a missing argument.
  try {
    fn(...names.map(() => 1));
  } catch (error) {
    return { fn: null, error: 'The expression is incomplete.' };
  }

  return { fn, error: null };
}

/** The names the UI can offer as a hint. */
export const KNOWN_NAMES = [...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS)];
