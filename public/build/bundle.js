
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35730/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    // Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
    // at the end of hydration without touching the remaining nodes.
    let is_hydrating = false;
    function start_hydrating() {
        is_hydrating = true;
    }
    function end_hydrating() {
        is_hydrating = false;
    }
    function upper_bound(low, high, key, value) {
        // Return first index of value larger than input value in the range [low, high)
        while (low < high) {
            const mid = low + ((high - low) >> 1);
            if (key(mid) <= value) {
                low = mid + 1;
            }
            else {
                high = mid;
            }
        }
        return low;
    }
    function init_hydrate(target) {
        if (target.hydrate_init)
            return;
        target.hydrate_init = true;
        // We know that all children have claim_order values since the unclaimed have been detached
        const children = target.childNodes;
        /*
        * Reorder claimed children optimally.
        * We can reorder claimed children optimally by finding the longest subsequence of
        * nodes that are already claimed in order and only moving the rest. The longest
        * subsequence subsequence of nodes that are claimed in order can be found by
        * computing the longest increasing subsequence of .claim_order values.
        *
        * This algorithm is optimal in generating the least amount of reorder operations
        * possible.
        *
        * Proof:
        * We know that, given a set of reordering operations, the nodes that do not move
        * always form an increasing subsequence, since they do not move among each other
        * meaning that they must be already ordered among each other. Thus, the maximal
        * set of nodes that do not move form a longest increasing subsequence.
        */
        // Compute longest increasing subsequence
        // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
        const m = new Int32Array(children.length + 1);
        // Predecessor indices + 1
        const p = new Int32Array(children.length);
        m[0] = -1;
        let longest = 0;
        for (let i = 0; i < children.length; i++) {
            const current = children[i].claim_order;
            // Find the largest subsequence length such that it ends in a value less than our current value
            // upper_bound returns first greater value, so we subtract one
            const seqLen = upper_bound(1, longest + 1, idx => children[m[idx]].claim_order, current) - 1;
            p[i] = m[seqLen] + 1;
            const newLen = seqLen + 1;
            // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
            m[newLen] = i;
            longest = Math.max(newLen, longest);
        }
        // The longest increasing subsequence of nodes (initially reversed)
        const lis = [];
        // The rest of the nodes, nodes that will be moved
        const toMove = [];
        let last = children.length - 1;
        for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
            lis.push(children[cur - 1]);
            for (; last >= cur; last--) {
                toMove.push(children[last]);
            }
            last--;
        }
        for (; last >= 0; last--) {
            toMove.push(children[last]);
        }
        lis.reverse();
        // We sort the nodes being moved to guarantee that their insertion order matches the claim order
        toMove.sort((a, b) => a.claim_order - b.claim_order);
        // Finally, we move the nodes
        for (let i = 0, j = 0; i < toMove.length; i++) {
            while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
                j++;
            }
            const anchor = j < lis.length ? lis[j] : null;
            target.insertBefore(toMove[i], anchor);
        }
    }
    function append(target, node) {
        if (is_hydrating) {
            init_hydrate(target);
            if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentElement !== target))) {
                target.actual_end_child = target.firstChild;
            }
            if (node !== target.actual_end_child) {
                target.insertBefore(node, target.actual_end_child);
            }
            else {
                target.actual_end_child = node.nextSibling;
            }
        }
        else if (node.parentNode !== target) {
            target.appendChild(node);
        }
    }
    function insert(target, node, anchor) {
        if (is_hydrating && !anchor) {
            append(target, node);
        }
        else if (node.parentNode !== target || (anchor && node.nextSibling !== anchor)) {
            target.insertBefore(node, anchor || null);
        }
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                start_hydrating();
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            end_hydrating();
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function getDefaultExportFromCjs (x) {
    	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
    }

    function createCommonjsModule(fn) {
      var module = { exports: {} };
    	return fn(module, module.exports), module.exports;
    }

    /**
     * Parses an URI
     *
     * @author Steven Levithan <stevenlevithan.com> (MIT license)
     * @api private
     */
    var re = /^(?:(?![^:@]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;

    var parts = [
        'source', 'protocol', 'authority', 'userInfo', 'user', 'password', 'host', 'port', 'relative', 'path', 'directory', 'file', 'query', 'anchor'
    ];

    var parseuri = function parseuri(str) {
        var src = str,
            b = str.indexOf('['),
            e = str.indexOf(']');

        if (b != -1 && e != -1) {
            str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ';') + str.substring(e, str.length);
        }

        var m = re.exec(str || ''),
            uri = {},
            i = 14;

        while (i--) {
            uri[parts[i]] = m[i] || '';
        }

        if (b != -1 && e != -1) {
            uri.source = src;
            uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ':');
            uri.authority = uri.authority.replace('[', '').replace(']', '').replace(/;/g, ':');
            uri.ipv6uri = true;
        }

        uri.pathNames = pathNames(uri, uri['path']);
        uri.queryKey = queryKey(uri, uri['query']);

        return uri;
    };

    function pathNames(obj, path) {
        var regx = /\/{2,9}/g,
            names = path.replace(regx, "/").split("/");

        if (path.substr(0, 1) == '/' || path.length === 0) {
            names.splice(0, 1);
        }
        if (path.substr(path.length - 1, 1) == '/') {
            names.splice(names.length - 1, 1);
        }

        return names;
    }

    function queryKey(uri, query) {
        var data = {};

        query.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function ($0, $1, $2) {
            if ($1) {
                data[$1] = $2;
            }
        });

        return data;
    }

    /**
     * Helpers.
     */
    var s = 1000;
    var m = s * 60;
    var h = m * 60;
    var d = h * 24;
    var w = d * 7;
    var y = d * 365.25;

    /**
     * Parse or format the given `val`.
     *
     * Options:
     *
     *  - `long` verbose formatting [false]
     *
     * @param {String|Number} val
     * @param {Object} [options]
     * @throws {Error} throw an error if val is not a non-empty string or a number
     * @return {String|Number}
     * @api public
     */

    var ms = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === 'string' && val.length > 0) {
        return parse(val);
      } else if (type === 'number' && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        'val is not a non-empty string or a valid number. val=' +
          JSON.stringify(val)
      );
    };

    /**
     * Parse the given `str` and return milliseconds.
     *
     * @param {String} str
     * @return {Number}
     * @api private
     */

    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || 'ms').toLowerCase();
      switch (type) {
        case 'years':
        case 'year':
        case 'yrs':
        case 'yr':
        case 'y':
          return n * y;
        case 'weeks':
        case 'week':
        case 'w':
          return n * w;
        case 'days':
        case 'day':
        case 'd':
          return n * d;
        case 'hours':
        case 'hour':
        case 'hrs':
        case 'hr':
        case 'h':
          return n * h;
        case 'minutes':
        case 'minute':
        case 'mins':
        case 'min':
        case 'm':
          return n * m;
        case 'seconds':
        case 'second':
        case 'secs':
        case 'sec':
        case 's':
          return n * s;
        case 'milliseconds':
        case 'millisecond':
        case 'msecs':
        case 'msec':
        case 'ms':
          return n;
        default:
          return undefined;
      }
    }

    /**
     * Short format for `ms`.
     *
     * @param {Number} ms
     * @return {String}
     * @api private
     */

    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + 'd';
      }
      if (msAbs >= h) {
        return Math.round(ms / h) + 'h';
      }
      if (msAbs >= m) {
        return Math.round(ms / m) + 'm';
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + 's';
      }
      return ms + 'ms';
    }

    /**
     * Long format for `ms`.
     *
     * @param {Number} ms
     * @return {String}
     * @api private
     */

    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, 'day');
      }
      if (msAbs >= h) {
        return plural(ms, msAbs, h, 'hour');
      }
      if (msAbs >= m) {
        return plural(ms, msAbs, m, 'minute');
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, 'second');
      }
      return ms + ' ms';
    }

    /**
     * Pluralization helper.
     */

    function plural(ms, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
    }

    /**
     * This is the common logic for both the Node.js and web browser
     * implementations of `debug()`.
     */

    function setup(env) {
    	createDebug.debug = createDebug;
    	createDebug.default = createDebug;
    	createDebug.coerce = coerce;
    	createDebug.disable = disable;
    	createDebug.enable = enable;
    	createDebug.enabled = enabled;
    	createDebug.humanize = ms;
    	createDebug.destroy = destroy;

    	Object.keys(env).forEach(key => {
    		createDebug[key] = env[key];
    	});

    	/**
    	* The currently active debug mode names, and names to skip.
    	*/

    	createDebug.names = [];
    	createDebug.skips = [];

    	/**
    	* Map of special "%n" handling functions, for the debug "format" argument.
    	*
    	* Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
    	*/
    	createDebug.formatters = {};

    	/**
    	* Selects a color for a debug namespace
    	* @param {String} namespace The namespace string for the for the debug instance to be colored
    	* @return {Number|String} An ANSI color code for the given namespace
    	* @api private
    	*/
    	function selectColor(namespace) {
    		let hash = 0;

    		for (let i = 0; i < namespace.length; i++) {
    			hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
    			hash |= 0; // Convert to 32bit integer
    		}

    		return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    	}
    	createDebug.selectColor = selectColor;

    	/**
    	* Create a debugger with the given `namespace`.
    	*
    	* @param {String} namespace
    	* @return {Function}
    	* @api public
    	*/
    	function createDebug(namespace) {
    		let prevTime;
    		let enableOverride = null;
    		let namespacesCache;
    		let enabledCache;

    		function debug(...args) {
    			// Disabled?
    			if (!debug.enabled) {
    				return;
    			}

    			const self = debug;

    			// Set `diff` timestamp
    			const curr = Number(new Date());
    			const ms = curr - (prevTime || curr);
    			self.diff = ms;
    			self.prev = prevTime;
    			self.curr = curr;
    			prevTime = curr;

    			args[0] = createDebug.coerce(args[0]);

    			if (typeof args[0] !== 'string') {
    				// Anything else let's inspect with %O
    				args.unshift('%O');
    			}

    			// Apply any `formatters` transformations
    			let index = 0;
    			args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
    				// If we encounter an escaped % then don't increase the array index
    				if (match === '%%') {
    					return '%';
    				}
    				index++;
    				const formatter = createDebug.formatters[format];
    				if (typeof formatter === 'function') {
    					const val = args[index];
    					match = formatter.call(self, val);

    					// Now we need to remove `args[index]` since it's inlined in the `format`
    					args.splice(index, 1);
    					index--;
    				}
    				return match;
    			});

    			// Apply env-specific formatting (colors, etc.)
    			createDebug.formatArgs.call(self, args);

    			const logFn = self.log || createDebug.log;
    			logFn.apply(self, args);
    		}

    		debug.namespace = namespace;
    		debug.useColors = createDebug.useColors();
    		debug.color = createDebug.selectColor(namespace);
    		debug.extend = extend;
    		debug.destroy = createDebug.destroy; // XXX Temporary. Will be removed in the next major release.

    		Object.defineProperty(debug, 'enabled', {
    			enumerable: true,
    			configurable: false,
    			get: () => {
    				if (enableOverride !== null) {
    					return enableOverride;
    				}
    				if (namespacesCache !== createDebug.namespaces) {
    					namespacesCache = createDebug.namespaces;
    					enabledCache = createDebug.enabled(namespace);
    				}

    				return enabledCache;
    			},
    			set: v => {
    				enableOverride = v;
    			}
    		});

    		// Env-specific initialization logic for debug instances
    		if (typeof createDebug.init === 'function') {
    			createDebug.init(debug);
    		}

    		return debug;
    	}

    	function extend(namespace, delimiter) {
    		const newDebug = createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
    		newDebug.log = this.log;
    		return newDebug;
    	}

    	/**
    	* Enables a debug mode by namespaces. This can include modes
    	* separated by a colon and wildcards.
    	*
    	* @param {String} namespaces
    	* @api public
    	*/
    	function enable(namespaces) {
    		createDebug.save(namespaces);
    		createDebug.namespaces = namespaces;

    		createDebug.names = [];
    		createDebug.skips = [];

    		let i;
    		const split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
    		const len = split.length;

    		for (i = 0; i < len; i++) {
    			if (!split[i]) {
    				// ignore empty strings
    				continue;
    			}

    			namespaces = split[i].replace(/\*/g, '.*?');

    			if (namespaces[0] === '-') {
    				createDebug.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    			} else {
    				createDebug.names.push(new RegExp('^' + namespaces + '$'));
    			}
    		}
    	}

    	/**
    	* Disable debug output.
    	*
    	* @return {String} namespaces
    	* @api public
    	*/
    	function disable() {
    		const namespaces = [
    			...createDebug.names.map(toNamespace),
    			...createDebug.skips.map(toNamespace).map(namespace => '-' + namespace)
    		].join(',');
    		createDebug.enable('');
    		return namespaces;
    	}

    	/**
    	* Returns true if the given mode name is enabled, false otherwise.
    	*
    	* @param {String} name
    	* @return {Boolean}
    	* @api public
    	*/
    	function enabled(name) {
    		if (name[name.length - 1] === '*') {
    			return true;
    		}

    		let i;
    		let len;

    		for (i = 0, len = createDebug.skips.length; i < len; i++) {
    			if (createDebug.skips[i].test(name)) {
    				return false;
    			}
    		}

    		for (i = 0, len = createDebug.names.length; i < len; i++) {
    			if (createDebug.names[i].test(name)) {
    				return true;
    			}
    		}

    		return false;
    	}

    	/**
    	* Convert regexp to namespace
    	*
    	* @param {RegExp} regxep
    	* @return {String} namespace
    	* @api private
    	*/
    	function toNamespace(regexp) {
    		return regexp.toString()
    			.substring(2, regexp.toString().length - 2)
    			.replace(/\.\*\?$/, '*');
    	}

    	/**
    	* Coerce `val`.
    	*
    	* @param {Mixed} val
    	* @return {Mixed}
    	* @api private
    	*/
    	function coerce(val) {
    		if (val instanceof Error) {
    			return val.stack || val.message;
    		}
    		return val;
    	}

    	/**
    	* XXX DO NOT USE. This is a temporary stub function.
    	* XXX It WILL be removed in the next major release.
    	*/
    	function destroy() {
    		console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
    	}

    	createDebug.enable(createDebug.load());

    	return createDebug;
    }

    var common = setup;

    /* eslint-env browser */

    var browser = createCommonjsModule(function (module, exports) {
    /**
     * This is the web browser implementation of `debug()`.
     */

    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = (() => {
    	let warned = false;

    	return () => {
    		if (!warned) {
    			warned = true;
    			console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
    		}
    	};
    })();

    /**
     * Colors.
     */

    exports.colors = [
    	'#0000CC',
    	'#0000FF',
    	'#0033CC',
    	'#0033FF',
    	'#0066CC',
    	'#0066FF',
    	'#0099CC',
    	'#0099FF',
    	'#00CC00',
    	'#00CC33',
    	'#00CC66',
    	'#00CC99',
    	'#00CCCC',
    	'#00CCFF',
    	'#3300CC',
    	'#3300FF',
    	'#3333CC',
    	'#3333FF',
    	'#3366CC',
    	'#3366FF',
    	'#3399CC',
    	'#3399FF',
    	'#33CC00',
    	'#33CC33',
    	'#33CC66',
    	'#33CC99',
    	'#33CCCC',
    	'#33CCFF',
    	'#6600CC',
    	'#6600FF',
    	'#6633CC',
    	'#6633FF',
    	'#66CC00',
    	'#66CC33',
    	'#9900CC',
    	'#9900FF',
    	'#9933CC',
    	'#9933FF',
    	'#99CC00',
    	'#99CC33',
    	'#CC0000',
    	'#CC0033',
    	'#CC0066',
    	'#CC0099',
    	'#CC00CC',
    	'#CC00FF',
    	'#CC3300',
    	'#CC3333',
    	'#CC3366',
    	'#CC3399',
    	'#CC33CC',
    	'#CC33FF',
    	'#CC6600',
    	'#CC6633',
    	'#CC9900',
    	'#CC9933',
    	'#CCCC00',
    	'#CCCC33',
    	'#FF0000',
    	'#FF0033',
    	'#FF0066',
    	'#FF0099',
    	'#FF00CC',
    	'#FF00FF',
    	'#FF3300',
    	'#FF3333',
    	'#FF3366',
    	'#FF3399',
    	'#FF33CC',
    	'#FF33FF',
    	'#FF6600',
    	'#FF6633',
    	'#FF9900',
    	'#FF9933',
    	'#FFCC00',
    	'#FFCC33'
    ];

    /**
     * Currently only WebKit-based Web Inspectors, Firefox >= v31,
     * and the Firebug extension (any Firefox version) are known
     * to support "%c" CSS customizations.
     *
     * TODO: add a `localStorage` variable to explicitly enable/disable colors
     */

    // eslint-disable-next-line complexity
    function useColors() {
    	// NB: In an Electron preload script, document will be defined but not fully
    	// initialized. Since we know we're in Chrome, we'll just detect this case
    	// explicitly
    	if (typeof window !== 'undefined' && window.process && (window.process.type === 'renderer' || window.process.__nwjs)) {
    		return true;
    	}

    	// Internet Explorer and Edge do not support colors.
    	if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
    		return false;
    	}

    	// Is webkit? http://stackoverflow.com/a/16459606/376773
    	// document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
    	return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
    		// Is firebug? http://stackoverflow.com/a/398120/376773
    		(typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
    		// Is firefox >= v31?
    		// https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
    		// Double check webkit in userAgent just in case we are in a worker
    		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
    }

    /**
     * Colorize log arguments if enabled.
     *
     * @api public
     */

    function formatArgs(args) {
    	args[0] = (this.useColors ? '%c' : '') +
    		this.namespace +
    		(this.useColors ? ' %c' : ' ') +
    		args[0] +
    		(this.useColors ? '%c ' : ' ') +
    		'+' + module.exports.humanize(this.diff);

    	if (!this.useColors) {
    		return;
    	}

    	const c = 'color: ' + this.color;
    	args.splice(1, 0, c, 'color: inherit');

    	// The final "%c" is somewhat tricky, because there could be other
    	// arguments passed either before or after the %c, so we need to
    	// figure out the correct index to insert the CSS into
    	let index = 0;
    	let lastC = 0;
    	args[0].replace(/%[a-zA-Z%]/g, match => {
    		if (match === '%%') {
    			return;
    		}
    		index++;
    		if (match === '%c') {
    			// We only are interested in the *last* %c
    			// (the user may have provided their own)
    			lastC = index;
    		}
    	});

    	args.splice(lastC, 0, c);
    }

    /**
     * Invokes `console.debug()` when available.
     * No-op when `console.debug` is not a "function".
     * If `console.debug` is not available, falls back
     * to `console.log`.
     *
     * @api public
     */
    exports.log = console.debug || console.log || (() => {});

    /**
     * Save `namespaces`.
     *
     * @param {String} namespaces
     * @api private
     */
    function save(namespaces) {
    	try {
    		if (namespaces) {
    			exports.storage.setItem('debug', namespaces);
    		} else {
    			exports.storage.removeItem('debug');
    		}
    	} catch (error) {
    		// Swallow
    		// XXX (@Qix-) should we be logging these?
    	}
    }

    /**
     * Load `namespaces`.
     *
     * @return {String} returns the previously persisted debug modes
     * @api private
     */
    function load() {
    	let r;
    	try {
    		r = exports.storage.getItem('debug');
    	} catch (error) {
    		// Swallow
    		// XXX (@Qix-) should we be logging these?
    	}

    	// If debug isn't set in LS, and we're in Electron, try to load $DEBUG
    	if (!r && typeof process !== 'undefined' && 'env' in process) {
    		r = process.env.DEBUG;
    	}

    	return r;
    }

    /**
     * Localstorage attempts to return the localstorage.
     *
     * This is necessary because safari throws
     * when a user disables cookies/localstorage
     * and you attempt to access it.
     *
     * @return {LocalStorage}
     * @api private
     */

    function localstorage() {
    	try {
    		// TVMLKit (Apple TV JS Runtime) does not have a window object, just localStorage in the global context
    		// The Browser also has localStorage in the global context.
    		return localStorage;
    	} catch (error) {
    		// Swallow
    		// XXX (@Qix-) should we be logging these?
    	}
    }

    module.exports = common(exports);

    const {formatters} = module.exports;

    /**
     * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
     */

    formatters.j = function (v) {
    	try {
    		return JSON.stringify(v);
    	} catch (error) {
    		return '[UnexpectedJSONParseError]: ' + error.message;
    	}
    };
    });

    var url_1 = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.url = void 0;

    const debug = browser("socket.io-client:url");
    /**
     * URL parser.
     *
     * @param uri - url
     * @param path - the request path of the connection
     * @param loc - An object meant to mimic window.location.
     *        Defaults to window.location.
     * @public
     */
    function url(uri, path = "", loc) {
        let obj = uri;
        // default to window.location
        loc = loc || (typeof location !== "undefined" && location);
        if (null == uri)
            uri = loc.protocol + "//" + loc.host;
        // relative path support
        if (typeof uri === "string") {
            if ("/" === uri.charAt(0)) {
                if ("/" === uri.charAt(1)) {
                    uri = loc.protocol + uri;
                }
                else {
                    uri = loc.host + uri;
                }
            }
            if (!/^(https?|wss?):\/\//.test(uri)) {
                debug("protocol-less url %s", uri);
                if ("undefined" !== typeof loc) {
                    uri = loc.protocol + "//" + uri;
                }
                else {
                    uri = "https://" + uri;
                }
            }
            // parse
            debug("parse %s", uri);
            obj = parseuri(uri);
        }
        // make sure we treat `localhost:80` and `localhost` equally
        if (!obj.port) {
            if (/^(http|ws)$/.test(obj.protocol)) {
                obj.port = "80";
            }
            else if (/^(http|ws)s$/.test(obj.protocol)) {
                obj.port = "443";
            }
        }
        obj.path = obj.path || "/";
        const ipv6 = obj.host.indexOf(":") !== -1;
        const host = ipv6 ? "[" + obj.host + "]" : obj.host;
        // define unique id
        obj.id = obj.protocol + "://" + host + ":" + obj.port + path;
        // define href
        obj.href =
            obj.protocol +
                "://" +
                host +
                (loc && loc.port === obj.port ? "" : ":" + obj.port);
        return obj;
    }
    exports.url = url;
    });

    var hasCors = createCommonjsModule(function (module) {
    /**
     * Module exports.
     *
     * Logic borrowed from Modernizr:
     *
     *   - https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cors.js
     */

    try {
      module.exports = typeof XMLHttpRequest !== 'undefined' &&
        'withCredentials' in new XMLHttpRequest();
    } catch (err) {
      // if XMLHttp support is disabled in IE then it will throw
      // when trying to create
      module.exports = false;
    }
    });

    var globalThis_browser = (() => {
      if (typeof self !== "undefined") {
        return self;
      } else if (typeof window !== "undefined") {
        return window;
      } else {
        return Function("return this")();
      }
    })();

    // browser shim for xmlhttprequest module




    var xmlhttprequest = function(opts) {
      const xdomain = opts.xdomain;

      // scheme must be same when usign XDomainRequest
      // http://blogs.msdn.com/b/ieinternals/archive/2010/05/13/xdomainrequest-restrictions-limitations-and-workarounds.aspx
      const xscheme = opts.xscheme;

      // XDomainRequest has a flow of not sending cookie, therefore it should be disabled as a default.
      // https://github.com/Automattic/engine.io-client/pull/217
      const enablesXDR = opts.enablesXDR;

      // XMLHttpRequest can be disabled on IE
      try {
        if ("undefined" !== typeof XMLHttpRequest && (!xdomain || hasCors)) {
          return new XMLHttpRequest();
        }
      } catch (e) {}

      // Use XDomainRequest for IE8 if enablesXDR is true
      // because loading bar keeps flashing when using jsonp-polling
      // https://github.com/yujiosaka/socke.io-ie8-loading-example
      try {
        if ("undefined" !== typeof XDomainRequest && !xscheme && enablesXDR) {
          return new XDomainRequest();
        }
      } catch (e) {}

      if (!xdomain) {
        try {
          return new globalThis_browser[["Active"].concat("Object").join("X")](
            "Microsoft.XMLHTTP"
          );
        } catch (e) {}
      }
    };

    const PACKET_TYPES$1 = Object.create(null); // no Map = no polyfill
    PACKET_TYPES$1["open"] = "0";
    PACKET_TYPES$1["close"] = "1";
    PACKET_TYPES$1["ping"] = "2";
    PACKET_TYPES$1["pong"] = "3";
    PACKET_TYPES$1["message"] = "4";
    PACKET_TYPES$1["upgrade"] = "5";
    PACKET_TYPES$1["noop"] = "6";

    const PACKET_TYPES_REVERSE$1 = Object.create(null);
    Object.keys(PACKET_TYPES$1).forEach(key => {
      PACKET_TYPES_REVERSE$1[PACKET_TYPES$1[key]] = key;
    });

    const ERROR_PACKET$1 = { type: "error", data: "parser error" };

    var commons = {
      PACKET_TYPES: PACKET_TYPES$1,
      PACKET_TYPES_REVERSE: PACKET_TYPES_REVERSE$1,
      ERROR_PACKET: ERROR_PACKET$1
    };

    const { PACKET_TYPES } = commons;

    const withNativeBlob =
      typeof Blob === "function" ||
      (typeof Blob !== "undefined" &&
        Object.prototype.toString.call(Blob) === "[object BlobConstructor]");
    const withNativeArrayBuffer$1 = typeof ArrayBuffer === "function";

    // ArrayBuffer.isView method is not defined in IE10
    const isView = obj => {
      return typeof ArrayBuffer.isView === "function"
        ? ArrayBuffer.isView(obj)
        : obj && obj.buffer instanceof ArrayBuffer;
    };

    const encodePacket = ({ type, data }, supportsBinary, callback) => {
      if (withNativeBlob && data instanceof Blob) {
        if (supportsBinary) {
          return callback(data);
        } else {
          return encodeBlobAsBase64(data, callback);
        }
      } else if (
        withNativeArrayBuffer$1 &&
        (data instanceof ArrayBuffer || isView(data))
      ) {
        if (supportsBinary) {
          return callback(data instanceof ArrayBuffer ? data : data.buffer);
        } else {
          return encodeBlobAsBase64(new Blob([data]), callback);
        }
      }
      // plain string
      return callback(PACKET_TYPES[type] + (data || ""));
    };

    const encodeBlobAsBase64 = (data, callback) => {
      const fileReader = new FileReader();
      fileReader.onload = function() {
        const content = fileReader.result.split(",")[1];
        callback("b" + content);
      };
      return fileReader.readAsDataURL(data);
    };

    var encodePacket_browser = encodePacket;

    /*
     * base64-arraybuffer
     * https://github.com/niklasvh/base64-arraybuffer
     *
     * Copyright (c) 2012 Niklas von Hertzen
     * Licensed under the MIT license.
     */

    var base64Arraybuffer = createCommonjsModule(function (module, exports) {
    (function(chars){

      exports.encode = function(arraybuffer) {
        var bytes = new Uint8Array(arraybuffer),
        i, len = bytes.length, base64 = "";

        for (i = 0; i < len; i+=3) {
          base64 += chars[bytes[i] >> 2];
          base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
          base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
          base64 += chars[bytes[i + 2] & 63];
        }

        if ((len % 3) === 2) {
          base64 = base64.substring(0, base64.length - 1) + "=";
        } else if (len % 3 === 1) {
          base64 = base64.substring(0, base64.length - 2) + "==";
        }

        return base64;
      };

      exports.decode =  function(base64) {
        var bufferLength = base64.length * 0.75,
        len = base64.length, i, p = 0,
        encoded1, encoded2, encoded3, encoded4;

        if (base64[base64.length - 1] === "=") {
          bufferLength--;
          if (base64[base64.length - 2] === "=") {
            bufferLength--;
          }
        }

        var arraybuffer = new ArrayBuffer(bufferLength),
        bytes = new Uint8Array(arraybuffer);

        for (i = 0; i < len; i+=4) {
          encoded1 = chars.indexOf(base64[i]);
          encoded2 = chars.indexOf(base64[i+1]);
          encoded3 = chars.indexOf(base64[i+2]);
          encoded4 = chars.indexOf(base64[i+3]);

          bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
          bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
          bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }

        return arraybuffer;
      };
    })("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
    });

    const { PACKET_TYPES_REVERSE, ERROR_PACKET } = commons;

    const withNativeArrayBuffer = typeof ArrayBuffer === "function";

    let base64decoder;
    if (withNativeArrayBuffer) {
      base64decoder = base64Arraybuffer;
    }

    const decodePacket = (encodedPacket, binaryType) => {
      if (typeof encodedPacket !== "string") {
        return {
          type: "message",
          data: mapBinary(encodedPacket, binaryType)
        };
      }
      const type = encodedPacket.charAt(0);
      if (type === "b") {
        return {
          type: "message",
          data: decodeBase64Packet(encodedPacket.substring(1), binaryType)
        };
      }
      const packetType = PACKET_TYPES_REVERSE[type];
      if (!packetType) {
        return ERROR_PACKET;
      }
      return encodedPacket.length > 1
        ? {
            type: PACKET_TYPES_REVERSE[type],
            data: encodedPacket.substring(1)
          }
        : {
            type: PACKET_TYPES_REVERSE[type]
          };
    };

    const decodeBase64Packet = (data, binaryType) => {
      if (base64decoder) {
        const decoded = base64decoder.decode(data);
        return mapBinary(decoded, binaryType);
      } else {
        return { base64: true, data }; // fallback for old browsers
      }
    };

    const mapBinary = (data, binaryType) => {
      switch (binaryType) {
        case "blob":
          return data instanceof ArrayBuffer ? new Blob([data]) : data;
        case "arraybuffer":
        default:
          return data; // assuming the data is already an ArrayBuffer
      }
    };

    var decodePacket_browser = decodePacket;

    const SEPARATOR = String.fromCharCode(30); // see https://en.wikipedia.org/wiki/Delimiter#ASCII_delimited_text

    const encodePayload = (packets, callback) => {
      // some packets may be added to the array while encoding, so the initial length must be saved
      const length = packets.length;
      const encodedPackets = new Array(length);
      let count = 0;

      packets.forEach((packet, i) => {
        // force base64 encoding for binary packets
        encodePacket_browser(packet, false, encodedPacket => {
          encodedPackets[i] = encodedPacket;
          if (++count === length) {
            callback(encodedPackets.join(SEPARATOR));
          }
        });
      });
    };

    const decodePayload = (encodedPayload, binaryType) => {
      const encodedPackets = encodedPayload.split(SEPARATOR);
      const packets = [];
      for (let i = 0; i < encodedPackets.length; i++) {
        const decodedPacket = decodePacket_browser(encodedPackets[i], binaryType);
        packets.push(decodedPacket);
        if (decodedPacket.type === "error") {
          break;
        }
      }
      return packets;
    };

    var lib$1 = {
      protocol: 4,
      encodePacket: encodePacket_browser,
      encodePayload,
      decodePacket: decodePacket_browser,
      decodePayload
    };

    var componentEmitter = createCommonjsModule(function (module) {
    /**
     * Expose `Emitter`.
     */

    {
      module.exports = Emitter;
    }

    /**
     * Initialize a new `Emitter`.
     *
     * @api public
     */

    function Emitter(obj) {
      if (obj) return mixin(obj);
    }
    /**
     * Mixin the emitter properties.
     *
     * @param {Object} obj
     * @return {Object}
     * @api private
     */

    function mixin(obj) {
      for (var key in Emitter.prototype) {
        obj[key] = Emitter.prototype[key];
      }
      return obj;
    }

    /**
     * Listen on the given `event` with `fn`.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.on =
    Emitter.prototype.addEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};
      (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
        .push(fn);
      return this;
    };

    /**
     * Adds an `event` listener that will be invoked a single
     * time then automatically removed.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.once = function(event, fn){
      function on() {
        this.off(event, on);
        fn.apply(this, arguments);
      }

      on.fn = fn;
      this.on(event, on);
      return this;
    };

    /**
     * Remove the given callback for `event` or all
     * registered callbacks.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.off =
    Emitter.prototype.removeListener =
    Emitter.prototype.removeAllListeners =
    Emitter.prototype.removeEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};

      // all
      if (0 == arguments.length) {
        this._callbacks = {};
        return this;
      }

      // specific event
      var callbacks = this._callbacks['$' + event];
      if (!callbacks) return this;

      // remove all handlers
      if (1 == arguments.length) {
        delete this._callbacks['$' + event];
        return this;
      }

      // remove specific handler
      var cb;
      for (var i = 0; i < callbacks.length; i++) {
        cb = callbacks[i];
        if (cb === fn || cb.fn === fn) {
          callbacks.splice(i, 1);
          break;
        }
      }

      // Remove event specific arrays for event types that no
      // one is subscribed for to avoid memory leak.
      if (callbacks.length === 0) {
        delete this._callbacks['$' + event];
      }

      return this;
    };

    /**
     * Emit `event` with the given args.
     *
     * @param {String} event
     * @param {Mixed} ...
     * @return {Emitter}
     */

    Emitter.prototype.emit = function(event){
      this._callbacks = this._callbacks || {};

      var args = new Array(arguments.length - 1)
        , callbacks = this._callbacks['$' + event];

      for (var i = 1; i < arguments.length; i++) {
        args[i - 1] = arguments[i];
      }

      if (callbacks) {
        callbacks = callbacks.slice(0);
        for (var i = 0, len = callbacks.length; i < len; ++i) {
          callbacks[i].apply(this, args);
        }
      }

      return this;
    };

    /**
     * Return array of callbacks for `event`.
     *
     * @param {String} event
     * @return {Array}
     * @api public
     */

    Emitter.prototype.listeners = function(event){
      this._callbacks = this._callbacks || {};
      return this._callbacks['$' + event] || [];
    };

    /**
     * Check if this emitter has `event` handlers.
     *
     * @param {String} event
     * @return {Boolean}
     * @api public
     */

    Emitter.prototype.hasListeners = function(event){
      return !! this.listeners(event).length;
    };
    });

    const debug$4 = browser("engine.io-client:transport");

    class Transport$1 extends componentEmitter {
      /**
       * Transport abstract constructor.
       *
       * @param {Object} options.
       * @api private
       */
      constructor(opts) {
        super();

        this.opts = opts;
        this.query = opts.query;
        this.readyState = "";
        this.socket = opts.socket;
      }

      /**
       * Emits an error.
       *
       * @param {String} str
       * @return {Transport} for chaining
       * @api public
       */
      onError(msg, desc) {
        const err = new Error(msg);
        err.type = "TransportError";
        err.description = desc;
        this.emit("error", err);
        return this;
      }

      /**
       * Opens the transport.
       *
       * @api public
       */
      open() {
        if ("closed" === this.readyState || "" === this.readyState) {
          this.readyState = "opening";
          this.doOpen();
        }

        return this;
      }

      /**
       * Closes the transport.
       *
       * @api private
       */
      close() {
        if ("opening" === this.readyState || "open" === this.readyState) {
          this.doClose();
          this.onClose();
        }

        return this;
      }

      /**
       * Sends multiple packets.
       *
       * @param {Array} packets
       * @api private
       */
      send(packets) {
        if ("open" === this.readyState) {
          this.write(packets);
        } else {
          // this might happen if the transport was silently closed in the beforeunload event handler
          debug$4("transport is not open, discarding packets");
        }
      }

      /**
       * Called upon open
       *
       * @api private
       */
      onOpen() {
        this.readyState = "open";
        this.writable = true;
        this.emit("open");
      }

      /**
       * Called with data.
       *
       * @param {String} data
       * @api private
       */
      onData(data) {
        const packet = lib$1.decodePacket(data, this.socket.binaryType);
        this.onPacket(packet);
      }

      /**
       * Called with a decoded packet.
       */
      onPacket(packet) {
        this.emit("packet", packet);
      }

      /**
       * Called upon close.
       *
       * @api private
       */
      onClose() {
        this.readyState = "closed";
        this.emit("close");
      }
    }

    var transport = Transport$1;

    /**
     * Compiles a querystring
     * Returns string representation of the object
     *
     * @param {Object}
     * @api private
     */
    var encode$1 = function (obj) {
      var str = '';

      for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
          if (str.length) str += '&';
          str += encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]);
        }
      }

      return str;
    };

    /**
     * Parses a simple querystring into an object
     *
     * @param {String} qs
     * @api private
     */

    var decode$1 = function(qs){
      var qry = {};
      var pairs = qs.split('&');
      for (var i = 0, l = pairs.length; i < l; i++) {
        var pair = pairs[i].split('=');
        qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
      }
      return qry;
    };

    var parseqs = {
    	encode: encode$1,
    	decode: decode$1
    };

    var alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'.split('')
      , length = 64
      , map = {}
      , seed = 0
      , i = 0
      , prev;

    /**
     * Return a string representing the specified number.
     *
     * @param {Number} num The number to convert.
     * @returns {String} The string representation of the number.
     * @api public
     */
    function encode(num) {
      var encoded = '';

      do {
        encoded = alphabet[num % length] + encoded;
        num = Math.floor(num / length);
      } while (num > 0);

      return encoded;
    }

    /**
     * Return the integer value specified by the given string.
     *
     * @param {String} str The string to convert.
     * @returns {Number} The integer value represented by the string.
     * @api public
     */
    function decode(str) {
      var decoded = 0;

      for (i = 0; i < str.length; i++) {
        decoded = decoded * length + map[str.charAt(i)];
      }

      return decoded;
    }

    /**
     * Yeast: A tiny growing id generator.
     *
     * @returns {String} A unique id.
     * @api public
     */
    function yeast() {
      var now = encode(+new Date());

      if (now !== prev) return seed = 0, prev = now;
      return now +'.'+ encode(seed++);
    }

    //
    // Map each character to its index.
    //
    for (; i < length; i++) map[alphabet[i]] = i;

    //
    // Expose the `yeast`, `encode` and `decode` functions.
    //
    yeast.encode = encode;
    yeast.decode = decode;
    var yeast_1 = yeast;

    const debug$3 = browser("engine.io-client:polling");

    class Polling extends transport {
      /**
       * Transport name.
       */
      get name() {
        return "polling";
      }

      /**
       * Opens the socket (triggers polling). We write a PING message to determine
       * when the transport is open.
       *
       * @api private
       */
      doOpen() {
        this.poll();
      }

      /**
       * Pauses polling.
       *
       * @param {Function} callback upon buffers are flushed and transport is paused
       * @api private
       */
      pause(onPause) {
        this.readyState = "pausing";

        const pause = () => {
          debug$3("paused");
          this.readyState = "paused";
          onPause();
        };

        if (this.polling || !this.writable) {
          let total = 0;

          if (this.polling) {
            debug$3("we are currently polling - waiting to pause");
            total++;
            this.once("pollComplete", function() {
              debug$3("pre-pause polling complete");
              --total || pause();
            });
          }

          if (!this.writable) {
            debug$3("we are currently writing - waiting to pause");
            total++;
            this.once("drain", function() {
              debug$3("pre-pause writing complete");
              --total || pause();
            });
          }
        } else {
          pause();
        }
      }

      /**
       * Starts polling cycle.
       *
       * @api public
       */
      poll() {
        debug$3("polling");
        this.polling = true;
        this.doPoll();
        this.emit("poll");
      }

      /**
       * Overloads onData to detect payloads.
       *
       * @api private
       */
      onData(data) {
        debug$3("polling got data %s", data);
        const callback = packet => {
          // if its the first message we consider the transport open
          if ("opening" === this.readyState && packet.type === "open") {
            this.onOpen();
          }

          // if its a close packet, we close the ongoing requests
          if ("close" === packet.type) {
            this.onClose();
            return false;
          }

          // otherwise bypass onData and handle the message
          this.onPacket(packet);
        };

        // decode payload
        lib$1.decodePayload(data, this.socket.binaryType).forEach(callback);

        // if an event did not trigger closing
        if ("closed" !== this.readyState) {
          // if we got data we're not polling
          this.polling = false;
          this.emit("pollComplete");

          if ("open" === this.readyState) {
            this.poll();
          } else {
            debug$3('ignoring poll - transport state "%s"', this.readyState);
          }
        }
      }

      /**
       * For polling, send a close packet.
       *
       * @api private
       */
      doClose() {
        const close = () => {
          debug$3("writing close packet");
          this.write([{ type: "close" }]);
        };

        if ("open" === this.readyState) {
          debug$3("transport open - closing");
          close();
        } else {
          // in case we're trying to close while
          // handshaking is in progress (GH-164)
          debug$3("transport not open - deferring close");
          this.once("open", close);
        }
      }

      /**
       * Writes a packets payload.
       *
       * @param {Array} data packets
       * @param {Function} drain callback
       * @api private
       */
      write(packets) {
        this.writable = false;

        lib$1.encodePayload(packets, data => {
          this.doWrite(data, () => {
            this.writable = true;
            this.emit("drain");
          });
        });
      }

      /**
       * Generates uri for connection.
       *
       * @api private
       */
      uri() {
        let query = this.query || {};
        const schema = this.opts.secure ? "https" : "http";
        let port = "";

        // cache busting is forced
        if (false !== this.opts.timestampRequests) {
          query[this.opts.timestampParam] = yeast_1();
        }

        if (!this.supportsBinary && !query.sid) {
          query.b64 = 1;
        }

        query = parseqs.encode(query);

        // avoid port if default for schema
        if (
          this.opts.port &&
          (("https" === schema && Number(this.opts.port) !== 443) ||
            ("http" === schema && Number(this.opts.port) !== 80))
        ) {
          port = ":" + this.opts.port;
        }

        // prepend ? to query
        if (query.length) {
          query = "?" + query;
        }

        const ipv6 = this.opts.hostname.indexOf(":") !== -1;
        return (
          schema +
          "://" +
          (ipv6 ? "[" + this.opts.hostname + "]" : this.opts.hostname) +
          port +
          this.opts.path +
          query
        );
      }
    }

    var polling$1 = Polling;

    var pick$2 = (obj, ...attr) => {
      return attr.reduce((acc, k) => {
        if (obj.hasOwnProperty(k)) {
          acc[k] = obj[k];
        }
        return acc;
      }, {});
    };

    var util = {
    	pick: pick$2
    };

    /* global attachEvent */

    const { pick: pick$1 } = util;


    const debug$2 = browser("engine.io-client:polling-xhr");

    /**
     * Empty function
     */

    function empty() {}

    const hasXHR2 = (function() {
      const xhr = new xmlhttprequest({ xdomain: false });
      return null != xhr.responseType;
    })();

    class XHR extends polling$1 {
      /**
       * XHR Polling constructor.
       *
       * @param {Object} opts
       * @api public
       */
      constructor(opts) {
        super(opts);

        if (typeof location !== "undefined") {
          const isSSL = "https:" === location.protocol;
          let port = location.port;

          // some user agents have empty `location.port`
          if (!port) {
            port = isSSL ? 443 : 80;
          }

          this.xd =
            (typeof location !== "undefined" &&
              opts.hostname !== location.hostname) ||
            port !== opts.port;
          this.xs = opts.secure !== isSSL;
        }
        /**
         * XHR supports binary
         */
        const forceBase64 = opts && opts.forceBase64;
        this.supportsBinary = hasXHR2 && !forceBase64;
      }

      /**
       * Creates a request.
       *
       * @param {String} method
       * @api private
       */
      request(opts = {}) {
        Object.assign(opts, { xd: this.xd, xs: this.xs }, this.opts);
        return new Request(this.uri(), opts);
      }

      /**
       * Sends data.
       *
       * @param {String} data to send.
       * @param {Function} called upon flush.
       * @api private
       */
      doWrite(data, fn) {
        const req = this.request({
          method: "POST",
          data: data
        });
        req.on("success", fn);
        req.on("error", err => {
          this.onError("xhr post error", err);
        });
      }

      /**
       * Starts a poll cycle.
       *
       * @api private
       */
      doPoll() {
        debug$2("xhr poll");
        const req = this.request();
        req.on("data", this.onData.bind(this));
        req.on("error", err => {
          this.onError("xhr poll error", err);
        });
        this.pollXhr = req;
      }
    }

    class Request extends componentEmitter {
      /**
       * Request constructor
       *
       * @param {Object} options
       * @api public
       */
      constructor(uri, opts) {
        super();
        this.opts = opts;

        this.method = opts.method || "GET";
        this.uri = uri;
        this.async = false !== opts.async;
        this.data = undefined !== opts.data ? opts.data : null;

        this.create();
      }

      /**
       * Creates the XHR object and sends the request.
       *
       * @api private
       */
      create() {
        const opts = pick$1(
          this.opts,
          "agent",
          "enablesXDR",
          "pfx",
          "key",
          "passphrase",
          "cert",
          "ca",
          "ciphers",
          "rejectUnauthorized",
          "autoUnref"
        );
        opts.xdomain = !!this.opts.xd;
        opts.xscheme = !!this.opts.xs;

        const xhr = (this.xhr = new xmlhttprequest(opts));

        try {
          debug$2("xhr open %s: %s", this.method, this.uri);
          xhr.open(this.method, this.uri, this.async);
          try {
            if (this.opts.extraHeaders) {
              xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
              for (let i in this.opts.extraHeaders) {
                if (this.opts.extraHeaders.hasOwnProperty(i)) {
                  xhr.setRequestHeader(i, this.opts.extraHeaders[i]);
                }
              }
            }
          } catch (e) {}

          if ("POST" === this.method) {
            try {
              xhr.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
            } catch (e) {}
          }

          try {
            xhr.setRequestHeader("Accept", "*/*");
          } catch (e) {}

          // ie6 check
          if ("withCredentials" in xhr) {
            xhr.withCredentials = this.opts.withCredentials;
          }

          if (this.opts.requestTimeout) {
            xhr.timeout = this.opts.requestTimeout;
          }

          if (this.hasXDR()) {
            xhr.onload = () => {
              this.onLoad();
            };
            xhr.onerror = () => {
              this.onError(xhr.responseText);
            };
          } else {
            xhr.onreadystatechange = () => {
              if (4 !== xhr.readyState) return;
              if (200 === xhr.status || 1223 === xhr.status) {
                this.onLoad();
              } else {
                // make sure the `error` event handler that's user-set
                // does not throw in the same tick and gets caught here
                setTimeout(() => {
                  this.onError(typeof xhr.status === "number" ? xhr.status : 0);
                }, 0);
              }
            };
          }

          debug$2("xhr data %s", this.data);
          xhr.send(this.data);
        } catch (e) {
          // Need to defer since .create() is called directly from the constructor
          // and thus the 'error' event can only be only bound *after* this exception
          // occurs.  Therefore, also, we cannot throw here at all.
          setTimeout(() => {
            this.onError(e);
          }, 0);
          return;
        }

        if (typeof document !== "undefined") {
          this.index = Request.requestsCount++;
          Request.requests[this.index] = this;
        }
      }

      /**
       * Called upon successful response.
       *
       * @api private
       */
      onSuccess() {
        this.emit("success");
        this.cleanup();
      }

      /**
       * Called if we have data.
       *
       * @api private
       */
      onData(data) {
        this.emit("data", data);
        this.onSuccess();
      }

      /**
       * Called upon error.
       *
       * @api private
       */
      onError(err) {
        this.emit("error", err);
        this.cleanup(true);
      }

      /**
       * Cleans up house.
       *
       * @api private
       */
      cleanup(fromError) {
        if ("undefined" === typeof this.xhr || null === this.xhr) {
          return;
        }
        // xmlhttprequest
        if (this.hasXDR()) {
          this.xhr.onload = this.xhr.onerror = empty;
        } else {
          this.xhr.onreadystatechange = empty;
        }

        if (fromError) {
          try {
            this.xhr.abort();
          } catch (e) {}
        }

        if (typeof document !== "undefined") {
          delete Request.requests[this.index];
        }

        this.xhr = null;
      }

      /**
       * Called upon load.
       *
       * @api private
       */
      onLoad() {
        const data = this.xhr.responseText;
        if (data !== null) {
          this.onData(data);
        }
      }

      /**
       * Check if it has XDomainRequest.
       *
       * @api private
       */
      hasXDR() {
        return typeof XDomainRequest !== "undefined" && !this.xs && this.enablesXDR;
      }

      /**
       * Aborts the request.
       *
       * @api public
       */
      abort() {
        this.cleanup();
      }
    }

    /**
     * Aborts pending requests when unloading the window. This is needed to prevent
     * memory leaks (e.g. when using IE) and to ensure that no spurious error is
     * emitted.
     */

    Request.requestsCount = 0;
    Request.requests = {};

    if (typeof document !== "undefined") {
      if (typeof attachEvent === "function") {
        attachEvent("onunload", unloadHandler);
      } else if (typeof addEventListener === "function") {
        const terminationEvent = "onpagehide" in globalThis_browser ? "pagehide" : "unload";
        addEventListener(terminationEvent, unloadHandler, false);
      }
    }

    function unloadHandler() {
      for (let i in Request.requests) {
        if (Request.requests.hasOwnProperty(i)) {
          Request.requests[i].abort();
        }
      }
    }

    var pollingXhr = XHR;
    var Request_1 = Request;
    pollingXhr.Request = Request_1;

    const rNewline = /\n/g;
    const rEscapedNewline = /\\n/g;

    /**
     * Global JSONP callbacks.
     */

    let callbacks;

    class JSONPPolling extends polling$1 {
      /**
       * JSONP Polling constructor.
       *
       * @param {Object} opts.
       * @api public
       */
      constructor(opts) {
        super(opts);

        this.query = this.query || {};

        // define global callbacks array if not present
        // we do this here (lazily) to avoid unneeded global pollution
        if (!callbacks) {
          // we need to consider multiple engines in the same page
          callbacks = globalThis_browser.___eio = globalThis_browser.___eio || [];
        }

        // callback identifier
        this.index = callbacks.length;

        // add callback to jsonp global
        callbacks.push(this.onData.bind(this));

        // append to query string
        this.query.j = this.index;
      }

      /**
       * JSONP only supports binary as base64 encoded strings
       */
      get supportsBinary() {
        return false;
      }

      /**
       * Closes the socket.
       *
       * @api private
       */
      doClose() {
        if (this.script) {
          // prevent spurious errors from being emitted when the window is unloaded
          this.script.onerror = () => {};
          this.script.parentNode.removeChild(this.script);
          this.script = null;
        }

        if (this.form) {
          this.form.parentNode.removeChild(this.form);
          this.form = null;
          this.iframe = null;
        }

        super.doClose();
      }

      /**
       * Starts a poll cycle.
       *
       * @api private
       */
      doPoll() {
        const script = document.createElement("script");

        if (this.script) {
          this.script.parentNode.removeChild(this.script);
          this.script = null;
        }

        script.async = true;
        script.src = this.uri();
        script.onerror = e => {
          this.onError("jsonp poll error", e);
        };

        const insertAt = document.getElementsByTagName("script")[0];
        if (insertAt) {
          insertAt.parentNode.insertBefore(script, insertAt);
        } else {
          (document.head || document.body).appendChild(script);
        }
        this.script = script;

        const isUAgecko =
          "undefined" !== typeof navigator && /gecko/i.test(navigator.userAgent);

        if (isUAgecko) {
          setTimeout(function() {
            const iframe = document.createElement("iframe");
            document.body.appendChild(iframe);
            document.body.removeChild(iframe);
          }, 100);
        }
      }

      /**
       * Writes with a hidden iframe.
       *
       * @param {String} data to send
       * @param {Function} called upon flush.
       * @api private
       */
      doWrite(data, fn) {
        let iframe;

        if (!this.form) {
          const form = document.createElement("form");
          const area = document.createElement("textarea");
          const id = (this.iframeId = "eio_iframe_" + this.index);

          form.className = "socketio";
          form.style.position = "absolute";
          form.style.top = "-1000px";
          form.style.left = "-1000px";
          form.target = id;
          form.method = "POST";
          form.setAttribute("accept-charset", "utf-8");
          area.name = "d";
          form.appendChild(area);
          document.body.appendChild(form);

          this.form = form;
          this.area = area;
        }

        this.form.action = this.uri();

        function complete() {
          initIframe();
          fn();
        }

        const initIframe = () => {
          if (this.iframe) {
            try {
              this.form.removeChild(this.iframe);
            } catch (e) {
              this.onError("jsonp polling iframe removal error", e);
            }
          }

          try {
            // ie6 dynamic iframes with target="" support (thanks Chris Lambacher)
            const html = '<iframe src="javascript:0" name="' + this.iframeId + '">';
            iframe = document.createElement(html);
          } catch (e) {
            iframe = document.createElement("iframe");
            iframe.name = this.iframeId;
            iframe.src = "javascript:0";
          }

          iframe.id = this.iframeId;

          this.form.appendChild(iframe);
          this.iframe = iframe;
        };

        initIframe();

        // escape \n to prevent it from being converted into \r\n by some UAs
        // double escaping is required for escaped new lines because unescaping of new lines can be done safely on server-side
        data = data.replace(rEscapedNewline, "\\\n");
        this.area.value = data.replace(rNewline, "\\n");

        try {
          this.form.submit();
        } catch (e) {}

        if (this.iframe.attachEvent) {
          this.iframe.onreadystatechange = () => {
            if (this.iframe.readyState === "complete") {
              complete();
            }
          };
        } else {
          this.iframe.onload = complete;
        }
      }
    }

    var pollingJsonp = JSONPPolling;

    const nextTick$1 = (() => {
      const isPromiseAvailable =
        typeof Promise === "function" && typeof Promise.resolve === "function";
      if (isPromiseAvailable) {
        return cb => Promise.resolve().then(cb);
      } else {
        return cb => setTimeout(cb, 0);
      }
    })();

    var websocketConstructor_browser = {
      WebSocket: globalThis_browser.WebSocket || globalThis_browser.MozWebSocket,
      usingBrowserWebSocket: true,
      defaultBinaryType: "arraybuffer",
      nextTick: nextTick$1
    };

    const { pick } = util;
    const {
      WebSocket,
      usingBrowserWebSocket,
      defaultBinaryType,
      nextTick
    } = websocketConstructor_browser;

    const debug$1 = browser("engine.io-client:websocket");

    // detect ReactNative environment
    const isReactNative =
      typeof navigator !== "undefined" &&
      typeof navigator.product === "string" &&
      navigator.product.toLowerCase() === "reactnative";

    class WS extends transport {
      /**
       * WebSocket transport constructor.
       *
       * @api {Object} connection options
       * @api public
       */
      constructor(opts) {
        super(opts);

        this.supportsBinary = !opts.forceBase64;
      }

      /**
       * Transport name.
       *
       * @api public
       */
      get name() {
        return "websocket";
      }

      /**
       * Opens socket.
       *
       * @api private
       */
      doOpen() {
        if (!this.check()) {
          // let probe timeout
          return;
        }

        const uri = this.uri();
        const protocols = this.opts.protocols;

        // React Native only supports the 'headers' option, and will print a warning if anything else is passed
        const opts = isReactNative
          ? {}
          : pick(
              this.opts,
              "agent",
              "perMessageDeflate",
              "pfx",
              "key",
              "passphrase",
              "cert",
              "ca",
              "ciphers",
              "rejectUnauthorized",
              "localAddress",
              "protocolVersion",
              "origin",
              "maxPayload",
              "family",
              "checkServerIdentity"
            );

        if (this.opts.extraHeaders) {
          opts.headers = this.opts.extraHeaders;
        }

        try {
          this.ws =
            usingBrowserWebSocket && !isReactNative
              ? protocols
                ? new WebSocket(uri, protocols)
                : new WebSocket(uri)
              : new WebSocket(uri, protocols, opts);
        } catch (err) {
          return this.emit("error", err);
        }

        this.ws.binaryType = this.socket.binaryType || defaultBinaryType;

        this.addEventListeners();
      }

      /**
       * Adds event listeners to the socket
       *
       * @api private
       */
      addEventListeners() {
        this.ws.onopen = () => {
          if (this.opts.autoUnref) {
            this.ws._socket.unref();
          }
          this.onOpen();
        };
        this.ws.onclose = this.onClose.bind(this);
        this.ws.onmessage = ev => this.onData(ev.data);
        this.ws.onerror = e => this.onError("websocket error", e);
      }

      /**
       * Writes data to socket.
       *
       * @param {Array} array of packets.
       * @api private
       */
      write(packets) {
        this.writable = false;

        // encodePacket efficient as it uses WS framing
        // no need for encodePayload
        for (let i = 0; i < packets.length; i++) {
          const packet = packets[i];
          const lastPacket = i === packets.length - 1;

          lib$1.encodePacket(packet, this.supportsBinary, data => {
            // always create a new object (GH-437)
            const opts = {};
            if (!usingBrowserWebSocket) {
              if (packet.options) {
                opts.compress = packet.options.compress;
              }

              if (this.opts.perMessageDeflate) {
                const len =
                  "string" === typeof data ? Buffer.byteLength(data) : data.length;
                if (len < this.opts.perMessageDeflate.threshold) {
                  opts.compress = false;
                }
              }
            }

            // Sometimes the websocket has already been closed but the browser didn't
            // have a chance of informing us about it yet, in that case send will
            // throw an error
            try {
              if (usingBrowserWebSocket) {
                // TypeError is thrown when passing the second argument on Safari
                this.ws.send(data);
              } else {
                this.ws.send(data, opts);
              }
            } catch (e) {
              debug$1("websocket closed before onclose event");
            }

            if (lastPacket) {
              // fake drain
              // defer to next tick to allow Socket to clear writeBuffer
              nextTick(() => {
                this.writable = true;
                this.emit("drain");
              });
            }
          });
        }
      }

      /**
       * Called upon close
       *
       * @api private
       */
      onClose() {
        transport.prototype.onClose.call(this);
      }

      /**
       * Closes socket.
       *
       * @api private
       */
      doClose() {
        if (typeof this.ws !== "undefined") {
          this.ws.close();
          this.ws = null;
        }
      }

      /**
       * Generates uri for connection.
       *
       * @api private
       */
      uri() {
        let query = this.query || {};
        const schema = this.opts.secure ? "wss" : "ws";
        let port = "";

        // avoid port if default for schema
        if (
          this.opts.port &&
          (("wss" === schema && Number(this.opts.port) !== 443) ||
            ("ws" === schema && Number(this.opts.port) !== 80))
        ) {
          port = ":" + this.opts.port;
        }

        // append timestamp to URI
        if (this.opts.timestampRequests) {
          query[this.opts.timestampParam] = yeast_1();
        }

        // communicate binary support capabilities
        if (!this.supportsBinary) {
          query.b64 = 1;
        }

        query = parseqs.encode(query);

        // prepend ? to query
        if (query.length) {
          query = "?" + query;
        }

        const ipv6 = this.opts.hostname.indexOf(":") !== -1;
        return (
          schema +
          "://" +
          (ipv6 ? "[" + this.opts.hostname + "]" : this.opts.hostname) +
          port +
          this.opts.path +
          query
        );
      }

      /**
       * Feature detection for WebSocket.
       *
       * @return {Boolean} whether this transport is available.
       * @api public
       */
      check() {
        return (
          !!WebSocket &&
          !("__initialize" in WebSocket && this.name === WS.prototype.name)
        );
      }
    }

    var websocket = WS;

    var polling_1 = polling;
    var websocket_1 = websocket;

    /**
     * Polling transport polymorphic constructor.
     * Decides on xhr vs jsonp based on feature detection.
     *
     * @api private
     */

    function polling(opts) {
      let xhr;
      let xd = false;
      let xs = false;
      const jsonp = false !== opts.jsonp;

      if (typeof location !== "undefined") {
        const isSSL = "https:" === location.protocol;
        let port = location.port;

        // some user agents have empty `location.port`
        if (!port) {
          port = isSSL ? 443 : 80;
        }

        xd = opts.hostname !== location.hostname || port !== opts.port;
        xs = opts.secure !== isSSL;
      }

      opts.xdomain = xd;
      opts.xscheme = xs;
      xhr = new xmlhttprequest(opts);

      if ("open" in xhr && !opts.forceJSONP) {
        return new pollingXhr(opts);
      } else {
        if (!jsonp) throw new Error("JSONP disabled");
        return new pollingJsonp(opts);
      }
    }

    var transports$1 = {
    	polling: polling_1,
    	websocket: websocket_1
    };

    const debug = browser("engine.io-client:socket");




    class Socket extends componentEmitter {
      /**
       * Socket constructor.
       *
       * @param {String|Object} uri or options
       * @param {Object} options
       * @api public
       */
      constructor(uri, opts = {}) {
        super();

        if (uri && "object" === typeof uri) {
          opts = uri;
          uri = null;
        }

        if (uri) {
          uri = parseuri(uri);
          opts.hostname = uri.host;
          opts.secure = uri.protocol === "https" || uri.protocol === "wss";
          opts.port = uri.port;
          if (uri.query) opts.query = uri.query;
        } else if (opts.host) {
          opts.hostname = parseuri(opts.host).host;
        }

        this.secure =
          null != opts.secure
            ? opts.secure
            : typeof location !== "undefined" && "https:" === location.protocol;

        if (opts.hostname && !opts.port) {
          // if no port is specified manually, use the protocol default
          opts.port = this.secure ? "443" : "80";
        }

        this.hostname =
          opts.hostname ||
          (typeof location !== "undefined" ? location.hostname : "localhost");
        this.port =
          opts.port ||
          (typeof location !== "undefined" && location.port
            ? location.port
            : this.secure
            ? 443
            : 80);

        this.transports = opts.transports || ["polling", "websocket"];
        this.readyState = "";
        this.writeBuffer = [];
        this.prevBufferLen = 0;

        this.opts = Object.assign(
          {
            path: "/engine.io",
            agent: false,
            withCredentials: false,
            upgrade: true,
            jsonp: true,
            timestampParam: "t",
            rememberUpgrade: false,
            rejectUnauthorized: true,
            perMessageDeflate: {
              threshold: 1024
            },
            transportOptions: {},
            closeOnBeforeunload: true
          },
          opts
        );

        this.opts.path = this.opts.path.replace(/\/$/, "") + "/";

        if (typeof this.opts.query === "string") {
          this.opts.query = parseqs.decode(this.opts.query);
        }

        // set on handshake
        this.id = null;
        this.upgrades = null;
        this.pingInterval = null;
        this.pingTimeout = null;

        // set on heartbeat
        this.pingTimeoutTimer = null;

        if (typeof addEventListener === "function") {
          if (this.opts.closeOnBeforeunload) {
            // Firefox closes the connection when the "beforeunload" event is emitted but not Chrome. This event listener
            // ensures every browser behaves the same (no "disconnect" event at the Socket.IO level when the page is
            // closed/reloaded)
            addEventListener(
              "beforeunload",
              () => {
                if (this.transport) {
                  // silently close the transport
                  this.transport.removeAllListeners();
                  this.transport.close();
                }
              },
              false
            );
          }
          if (this.hostname !== "localhost") {
            this.offlineEventListener = () => {
              this.onClose("transport close");
            };
            addEventListener("offline", this.offlineEventListener, false);
          }
        }

        this.open();
      }

      /**
       * Creates transport of the given type.
       *
       * @param {String} transport name
       * @return {Transport}
       * @api private
       */
      createTransport(name) {
        debug('creating transport "%s"', name);
        const query = clone(this.opts.query);

        // append engine.io protocol identifier
        query.EIO = lib$1.protocol;

        // transport name
        query.transport = name;

        // session id if we already have one
        if (this.id) query.sid = this.id;

        const opts = Object.assign(
          {},
          this.opts.transportOptions[name],
          this.opts,
          {
            query,
            socket: this,
            hostname: this.hostname,
            secure: this.secure,
            port: this.port
          }
        );

        debug("options: %j", opts);

        return new transports$1[name](opts);
      }

      /**
       * Initializes transport to use and starts probe.
       *
       * @api private
       */
      open() {
        let transport;
        if (
          this.opts.rememberUpgrade &&
          Socket.priorWebsocketSuccess &&
          this.transports.indexOf("websocket") !== -1
        ) {
          transport = "websocket";
        } else if (0 === this.transports.length) {
          // Emit error on next tick so it can be listened to
          setTimeout(() => {
            this.emit("error", "No transports available");
          }, 0);
          return;
        } else {
          transport = this.transports[0];
        }
        this.readyState = "opening";

        // Retry with the next transport if the transport is disabled (jsonp: false)
        try {
          transport = this.createTransport(transport);
        } catch (e) {
          debug("error while creating transport: %s", e);
          this.transports.shift();
          this.open();
          return;
        }

        transport.open();
        this.setTransport(transport);
      }

      /**
       * Sets the current transport. Disables the existing one (if any).
       *
       * @api private
       */
      setTransport(transport) {
        debug("setting transport %s", transport.name);

        if (this.transport) {
          debug("clearing existing transport %s", this.transport.name);
          this.transport.removeAllListeners();
        }

        // set up transport
        this.transport = transport;

        // set up transport listeners
        transport
          .on("drain", this.onDrain.bind(this))
          .on("packet", this.onPacket.bind(this))
          .on("error", this.onError.bind(this))
          .on("close", () => {
            this.onClose("transport close");
          });
      }

      /**
       * Probes a transport.
       *
       * @param {String} transport name
       * @api private
       */
      probe(name) {
        debug('probing transport "%s"', name);
        let transport = this.createTransport(name, { probe: 1 });
        let failed = false;

        Socket.priorWebsocketSuccess = false;

        const onTransportOpen = () => {
          if (failed) return;

          debug('probe transport "%s" opened', name);
          transport.send([{ type: "ping", data: "probe" }]);
          transport.once("packet", msg => {
            if (failed) return;
            if ("pong" === msg.type && "probe" === msg.data) {
              debug('probe transport "%s" pong', name);
              this.upgrading = true;
              this.emit("upgrading", transport);
              if (!transport) return;
              Socket.priorWebsocketSuccess = "websocket" === transport.name;

              debug('pausing current transport "%s"', this.transport.name);
              this.transport.pause(() => {
                if (failed) return;
                if ("closed" === this.readyState) return;
                debug("changing transport and sending upgrade packet");

                cleanup();

                this.setTransport(transport);
                transport.send([{ type: "upgrade" }]);
                this.emit("upgrade", transport);
                transport = null;
                this.upgrading = false;
                this.flush();
              });
            } else {
              debug('probe transport "%s" failed', name);
              const err = new Error("probe error");
              err.transport = transport.name;
              this.emit("upgradeError", err);
            }
          });
        };

        function freezeTransport() {
          if (failed) return;

          // Any callback called by transport should be ignored since now
          failed = true;

          cleanup();

          transport.close();
          transport = null;
        }

        // Handle any error that happens while probing
        const onerror = err => {
          const error = new Error("probe error: " + err);
          error.transport = transport.name;

          freezeTransport();

          debug('probe transport "%s" failed because of error: %s', name, err);

          this.emit("upgradeError", error);
        };

        function onTransportClose() {
          onerror("transport closed");
        }

        // When the socket is closed while we're probing
        function onclose() {
          onerror("socket closed");
        }

        // When the socket is upgraded while we're probing
        function onupgrade(to) {
          if (transport && to.name !== transport.name) {
            debug('"%s" works - aborting "%s"', to.name, transport.name);
            freezeTransport();
          }
        }

        // Remove all listeners on the transport and on self
        const cleanup = () => {
          transport.removeListener("open", onTransportOpen);
          transport.removeListener("error", onerror);
          transport.removeListener("close", onTransportClose);
          this.removeListener("close", onclose);
          this.removeListener("upgrading", onupgrade);
        };

        transport.once("open", onTransportOpen);
        transport.once("error", onerror);
        transport.once("close", onTransportClose);

        this.once("close", onclose);
        this.once("upgrading", onupgrade);

        transport.open();
      }

      /**
       * Called when connection is deemed open.
       *
       * @api public
       */
      onOpen() {
        debug("socket open");
        this.readyState = "open";
        Socket.priorWebsocketSuccess = "websocket" === this.transport.name;
        this.emit("open");
        this.flush();

        // we check for `readyState` in case an `open`
        // listener already closed the socket
        if (
          "open" === this.readyState &&
          this.opts.upgrade &&
          this.transport.pause
        ) {
          debug("starting upgrade probes");
          let i = 0;
          const l = this.upgrades.length;
          for (; i < l; i++) {
            this.probe(this.upgrades[i]);
          }
        }
      }

      /**
       * Handles a packet.
       *
       * @api private
       */
      onPacket(packet) {
        if (
          "opening" === this.readyState ||
          "open" === this.readyState ||
          "closing" === this.readyState
        ) {
          debug('socket receive: type "%s", data "%s"', packet.type, packet.data);

          this.emit("packet", packet);

          // Socket is live - any packet counts
          this.emit("heartbeat");

          switch (packet.type) {
            case "open":
              this.onHandshake(JSON.parse(packet.data));
              break;

            case "ping":
              this.resetPingTimeout();
              this.sendPacket("pong");
              this.emit("ping");
              this.emit("pong");
              break;

            case "error":
              const err = new Error("server error");
              err.code = packet.data;
              this.onError(err);
              break;

            case "message":
              this.emit("data", packet.data);
              this.emit("message", packet.data);
              break;
          }
        } else {
          debug('packet received with socket readyState "%s"', this.readyState);
        }
      }

      /**
       * Called upon handshake completion.
       *
       * @param {Object} handshake obj
       * @api private
       */
      onHandshake(data) {
        this.emit("handshake", data);
        this.id = data.sid;
        this.transport.query.sid = data.sid;
        this.upgrades = this.filterUpgrades(data.upgrades);
        this.pingInterval = data.pingInterval;
        this.pingTimeout = data.pingTimeout;
        this.onOpen();
        // In case open handler closes socket
        if ("closed" === this.readyState) return;
        this.resetPingTimeout();
      }

      /**
       * Sets and resets ping timeout timer based on server pings.
       *
       * @api private
       */
      resetPingTimeout() {
        clearTimeout(this.pingTimeoutTimer);
        this.pingTimeoutTimer = setTimeout(() => {
          this.onClose("ping timeout");
        }, this.pingInterval + this.pingTimeout);
        if (this.opts.autoUnref) {
          this.pingTimeoutTimer.unref();
        }
      }

      /**
       * Called on `drain` event
       *
       * @api private
       */
      onDrain() {
        this.writeBuffer.splice(0, this.prevBufferLen);

        // setting prevBufferLen = 0 is very important
        // for example, when upgrading, upgrade packet is sent over,
        // and a nonzero prevBufferLen could cause problems on `drain`
        this.prevBufferLen = 0;

        if (0 === this.writeBuffer.length) {
          this.emit("drain");
        } else {
          this.flush();
        }
      }

      /**
       * Flush write buffers.
       *
       * @api private
       */
      flush() {
        if (
          "closed" !== this.readyState &&
          this.transport.writable &&
          !this.upgrading &&
          this.writeBuffer.length
        ) {
          debug("flushing %d packets in socket", this.writeBuffer.length);
          this.transport.send(this.writeBuffer);
          // keep track of current length of writeBuffer
          // splice writeBuffer and callbackBuffer on `drain`
          this.prevBufferLen = this.writeBuffer.length;
          this.emit("flush");
        }
      }

      /**
       * Sends a message.
       *
       * @param {String} message.
       * @param {Function} callback function.
       * @param {Object} options.
       * @return {Socket} for chaining.
       * @api public
       */
      write(msg, options, fn) {
        this.sendPacket("message", msg, options, fn);
        return this;
      }

      send(msg, options, fn) {
        this.sendPacket("message", msg, options, fn);
        return this;
      }

      /**
       * Sends a packet.
       *
       * @param {String} packet type.
       * @param {String} data.
       * @param {Object} options.
       * @param {Function} callback function.
       * @api private
       */
      sendPacket(type, data, options, fn) {
        if ("function" === typeof data) {
          fn = data;
          data = undefined;
        }

        if ("function" === typeof options) {
          fn = options;
          options = null;
        }

        if ("closing" === this.readyState || "closed" === this.readyState) {
          return;
        }

        options = options || {};
        options.compress = false !== options.compress;

        const packet = {
          type: type,
          data: data,
          options: options
        };
        this.emit("packetCreate", packet);
        this.writeBuffer.push(packet);
        if (fn) this.once("flush", fn);
        this.flush();
      }

      /**
       * Closes the connection.
       *
       * @api private
       */
      close() {
        const close = () => {
          this.onClose("forced close");
          debug("socket closing - telling transport to close");
          this.transport.close();
        };

        const cleanupAndClose = () => {
          this.removeListener("upgrade", cleanupAndClose);
          this.removeListener("upgradeError", cleanupAndClose);
          close();
        };

        const waitForUpgrade = () => {
          // wait for upgrade to finish since we can't send packets while pausing a transport
          this.once("upgrade", cleanupAndClose);
          this.once("upgradeError", cleanupAndClose);
        };

        if ("opening" === this.readyState || "open" === this.readyState) {
          this.readyState = "closing";

          if (this.writeBuffer.length) {
            this.once("drain", () => {
              if (this.upgrading) {
                waitForUpgrade();
              } else {
                close();
              }
            });
          } else if (this.upgrading) {
            waitForUpgrade();
          } else {
            close();
          }
        }

        return this;
      }

      /**
       * Called upon transport error
       *
       * @api private
       */
      onError(err) {
        debug("socket error %j", err);
        Socket.priorWebsocketSuccess = false;
        this.emit("error", err);
        this.onClose("transport error", err);
      }

      /**
       * Called upon transport close.
       *
       * @api private
       */
      onClose(reason, desc) {
        if (
          "opening" === this.readyState ||
          "open" === this.readyState ||
          "closing" === this.readyState
        ) {
          debug('socket close with reason: "%s"', reason);

          // clear timers
          clearTimeout(this.pingIntervalTimer);
          clearTimeout(this.pingTimeoutTimer);

          // stop event from firing again for transport
          this.transport.removeAllListeners("close");

          // ensure transport won't stay open
          this.transport.close();

          // ignore further transport communication
          this.transport.removeAllListeners();

          if (typeof removeEventListener === "function") {
            removeEventListener("offline", this.offlineEventListener, false);
          }

          // set ready state
          this.readyState = "closed";

          // clear session id
          this.id = null;

          // emit close event
          this.emit("close", reason, desc);

          // clean buffers after, so users can still
          // grab the buffers on `close` event
          this.writeBuffer = [];
          this.prevBufferLen = 0;
        }
      }

      /**
       * Filters upgrades, returning only those matching client transports.
       *
       * @param {Array} server upgrades
       * @api private
       *
       */
      filterUpgrades(upgrades) {
        const filteredUpgrades = [];
        let i = 0;
        const j = upgrades.length;
        for (; i < j; i++) {
          if (~this.transports.indexOf(upgrades[i]))
            filteredUpgrades.push(upgrades[i]);
        }
        return filteredUpgrades;
      }
    }

    Socket.priorWebsocketSuccess = false;

    /**
     * Protocol version.
     *
     * @api public
     */

    Socket.protocol = lib$1.protocol; // this is an int

    function clone(obj) {
      const o = {};
      for (let i in obj) {
        if (obj.hasOwnProperty(i)) {
          o[i] = obj[i];
        }
      }
      return o;
    }

    var socket$2 = Socket;

    var lib = (uri, opts) => new socket$2(uri, opts);

    /**
     * Expose deps for legacy compatibility
     * and standalone browser access.
     */

    var Socket_1 = socket$2;
    var protocol = socket$2.protocol; // this is an int
    var Transport = transport;
    var transports = transports$1;
    var parser = lib$1;
    lib.Socket = Socket_1;
    lib.protocol = protocol;
    lib.Transport = Transport;
    lib.transports = transports;
    lib.parser = parser;

    var isBinary_1 = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.hasBinary = exports.isBinary = void 0;
    const withNativeArrayBuffer = typeof ArrayBuffer === "function";
    const isView = (obj) => {
        return typeof ArrayBuffer.isView === "function"
            ? ArrayBuffer.isView(obj)
            : obj.buffer instanceof ArrayBuffer;
    };
    const toString = Object.prototype.toString;
    const withNativeBlob = typeof Blob === "function" ||
        (typeof Blob !== "undefined" &&
            toString.call(Blob) === "[object BlobConstructor]");
    const withNativeFile = typeof File === "function" ||
        (typeof File !== "undefined" &&
            toString.call(File) === "[object FileConstructor]");
    /**
     * Returns true if obj is a Buffer, an ArrayBuffer, a Blob or a File.
     *
     * @private
     */
    function isBinary(obj) {
        return ((withNativeArrayBuffer && (obj instanceof ArrayBuffer || isView(obj))) ||
            (withNativeBlob && obj instanceof Blob) ||
            (withNativeFile && obj instanceof File));
    }
    exports.isBinary = isBinary;
    function hasBinary(obj, toJSON) {
        if (!obj || typeof obj !== "object") {
            return false;
        }
        if (Array.isArray(obj)) {
            for (let i = 0, l = obj.length; i < l; i++) {
                if (hasBinary(obj[i])) {
                    return true;
                }
            }
            return false;
        }
        if (isBinary(obj)) {
            return true;
        }
        if (obj.toJSON &&
            typeof obj.toJSON === "function" &&
            arguments.length === 1) {
            return hasBinary(obj.toJSON(), true);
        }
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
                return true;
            }
        }
        return false;
    }
    exports.hasBinary = hasBinary;
    });

    var binary = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.reconstructPacket = exports.deconstructPacket = void 0;

    /**
     * Replaces every Buffer | ArrayBuffer | Blob | File in packet with a numbered placeholder.
     *
     * @param {Object} packet - socket.io event packet
     * @return {Object} with deconstructed packet and list of buffers
     * @public
     */
    function deconstructPacket(packet) {
        const buffers = [];
        const packetData = packet.data;
        const pack = packet;
        pack.data = _deconstructPacket(packetData, buffers);
        pack.attachments = buffers.length; // number of binary 'attachments'
        return { packet: pack, buffers: buffers };
    }
    exports.deconstructPacket = deconstructPacket;
    function _deconstructPacket(data, buffers) {
        if (!data)
            return data;
        if (isBinary_1.isBinary(data)) {
            const placeholder = { _placeholder: true, num: buffers.length };
            buffers.push(data);
            return placeholder;
        }
        else if (Array.isArray(data)) {
            const newData = new Array(data.length);
            for (let i = 0; i < data.length; i++) {
                newData[i] = _deconstructPacket(data[i], buffers);
            }
            return newData;
        }
        else if (typeof data === "object" && !(data instanceof Date)) {
            const newData = {};
            for (const key in data) {
                if (data.hasOwnProperty(key)) {
                    newData[key] = _deconstructPacket(data[key], buffers);
                }
            }
            return newData;
        }
        return data;
    }
    /**
     * Reconstructs a binary packet from its placeholder packet and buffers
     *
     * @param {Object} packet - event packet with placeholders
     * @param {Array} buffers - binary buffers to put in placeholder positions
     * @return {Object} reconstructed packet
     * @public
     */
    function reconstructPacket(packet, buffers) {
        packet.data = _reconstructPacket(packet.data, buffers);
        packet.attachments = undefined; // no longer useful
        return packet;
    }
    exports.reconstructPacket = reconstructPacket;
    function _reconstructPacket(data, buffers) {
        if (!data)
            return data;
        if (data && data._placeholder) {
            return buffers[data.num]; // appropriate buffer (should be natural order anyway)
        }
        else if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                data[i] = _reconstructPacket(data[i], buffers);
            }
        }
        else if (typeof data === "object") {
            for (const key in data) {
                if (data.hasOwnProperty(key)) {
                    data[key] = _reconstructPacket(data[key], buffers);
                }
            }
        }
        return data;
    }
    });

    var dist = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Decoder = exports.Encoder = exports.PacketType = exports.protocol = void 0;



    const debug = browser("socket.io-parser");
    /**
     * Protocol version.
     *
     * @public
     */
    exports.protocol = 5;
    var PacketType;
    (function (PacketType) {
        PacketType[PacketType["CONNECT"] = 0] = "CONNECT";
        PacketType[PacketType["DISCONNECT"] = 1] = "DISCONNECT";
        PacketType[PacketType["EVENT"] = 2] = "EVENT";
        PacketType[PacketType["ACK"] = 3] = "ACK";
        PacketType[PacketType["CONNECT_ERROR"] = 4] = "CONNECT_ERROR";
        PacketType[PacketType["BINARY_EVENT"] = 5] = "BINARY_EVENT";
        PacketType[PacketType["BINARY_ACK"] = 6] = "BINARY_ACK";
    })(PacketType = exports.PacketType || (exports.PacketType = {}));
    /**
     * A socket.io Encoder instance
     */
    class Encoder {
        /**
         * Encode a packet as a single string if non-binary, or as a
         * buffer sequence, depending on packet type.
         *
         * @param {Object} obj - packet object
         */
        encode(obj) {
            debug("encoding packet %j", obj);
            if (obj.type === PacketType.EVENT || obj.type === PacketType.ACK) {
                if (isBinary_1.hasBinary(obj)) {
                    obj.type =
                        obj.type === PacketType.EVENT
                            ? PacketType.BINARY_EVENT
                            : PacketType.BINARY_ACK;
                    return this.encodeAsBinary(obj);
                }
            }
            return [this.encodeAsString(obj)];
        }
        /**
         * Encode packet as string.
         */
        encodeAsString(obj) {
            // first is type
            let str = "" + obj.type;
            // attachments if we have them
            if (obj.type === PacketType.BINARY_EVENT ||
                obj.type === PacketType.BINARY_ACK) {
                str += obj.attachments + "-";
            }
            // if we have a namespace other than `/`
            // we append it followed by a comma `,`
            if (obj.nsp && "/" !== obj.nsp) {
                str += obj.nsp + ",";
            }
            // immediately followed by the id
            if (null != obj.id) {
                str += obj.id;
            }
            // json data
            if (null != obj.data) {
                str += JSON.stringify(obj.data);
            }
            debug("encoded %j as %s", obj, str);
            return str;
        }
        /**
         * Encode packet as 'buffer sequence' by removing blobs, and
         * deconstructing packet into object with placeholders and
         * a list of buffers.
         */
        encodeAsBinary(obj) {
            const deconstruction = binary.deconstructPacket(obj);
            const pack = this.encodeAsString(deconstruction.packet);
            const buffers = deconstruction.buffers;
            buffers.unshift(pack); // add packet info to beginning of data list
            return buffers; // write all the buffers
        }
    }
    exports.Encoder = Encoder;
    /**
     * A socket.io Decoder instance
     *
     * @return {Object} decoder
     */
    class Decoder extends componentEmitter {
        constructor() {
            super();
        }
        /**
         * Decodes an encoded packet string into packet JSON.
         *
         * @param {String} obj - encoded packet
         */
        add(obj) {
            let packet;
            if (typeof obj === "string") {
                packet = this.decodeString(obj);
                if (packet.type === PacketType.BINARY_EVENT ||
                    packet.type === PacketType.BINARY_ACK) {
                    // binary packet's json
                    this.reconstructor = new BinaryReconstructor(packet);
                    // no attachments, labeled binary but no binary data to follow
                    if (packet.attachments === 0) {
                        super.emit("decoded", packet);
                    }
                }
                else {
                    // non-binary full packet
                    super.emit("decoded", packet);
                }
            }
            else if (isBinary_1.isBinary(obj) || obj.base64) {
                // raw binary data
                if (!this.reconstructor) {
                    throw new Error("got binary data when not reconstructing a packet");
                }
                else {
                    packet = this.reconstructor.takeBinaryData(obj);
                    if (packet) {
                        // received final buffer
                        this.reconstructor = null;
                        super.emit("decoded", packet);
                    }
                }
            }
            else {
                throw new Error("Unknown type: " + obj);
            }
        }
        /**
         * Decode a packet String (JSON data)
         *
         * @param {String} str
         * @return {Object} packet
         */
        decodeString(str) {
            let i = 0;
            // look up type
            const p = {
                type: Number(str.charAt(0)),
            };
            if (PacketType[p.type] === undefined) {
                throw new Error("unknown packet type " + p.type);
            }
            // look up attachments if type binary
            if (p.type === PacketType.BINARY_EVENT ||
                p.type === PacketType.BINARY_ACK) {
                const start = i + 1;
                while (str.charAt(++i) !== "-" && i != str.length) { }
                const buf = str.substring(start, i);
                if (buf != Number(buf) || str.charAt(i) !== "-") {
                    throw new Error("Illegal attachments");
                }
                p.attachments = Number(buf);
            }
            // look up namespace (if any)
            if ("/" === str.charAt(i + 1)) {
                const start = i + 1;
                while (++i) {
                    const c = str.charAt(i);
                    if ("," === c)
                        break;
                    if (i === str.length)
                        break;
                }
                p.nsp = str.substring(start, i);
            }
            else {
                p.nsp = "/";
            }
            // look up id
            const next = str.charAt(i + 1);
            if ("" !== next && Number(next) == next) {
                const start = i + 1;
                while (++i) {
                    const c = str.charAt(i);
                    if (null == c || Number(c) != c) {
                        --i;
                        break;
                    }
                    if (i === str.length)
                        break;
                }
                p.id = Number(str.substring(start, i + 1));
            }
            // look up json data
            if (str.charAt(++i)) {
                const payload = tryParse(str.substr(i));
                if (Decoder.isPayloadValid(p.type, payload)) {
                    p.data = payload;
                }
                else {
                    throw new Error("invalid payload");
                }
            }
            debug("decoded %s as %j", str, p);
            return p;
        }
        static isPayloadValid(type, payload) {
            switch (type) {
                case PacketType.CONNECT:
                    return typeof payload === "object";
                case PacketType.DISCONNECT:
                    return payload === undefined;
                case PacketType.CONNECT_ERROR:
                    return typeof payload === "string" || typeof payload === "object";
                case PacketType.EVENT:
                case PacketType.BINARY_EVENT:
                    return Array.isArray(payload) && payload.length > 0;
                case PacketType.ACK:
                case PacketType.BINARY_ACK:
                    return Array.isArray(payload);
            }
        }
        /**
         * Deallocates a parser's resources
         */
        destroy() {
            if (this.reconstructor) {
                this.reconstructor.finishedReconstruction();
            }
        }
    }
    exports.Decoder = Decoder;
    function tryParse(str) {
        try {
            return JSON.parse(str);
        }
        catch (e) {
            return false;
        }
    }
    /**
     * A manager of a binary event's 'buffer sequence'. Should
     * be constructed whenever a packet of type BINARY_EVENT is
     * decoded.
     *
     * @param {Object} packet
     * @return {BinaryReconstructor} initialized reconstructor
     */
    class BinaryReconstructor {
        constructor(packet) {
            this.packet = packet;
            this.buffers = [];
            this.reconPack = packet;
        }
        /**
         * Method to be called when binary data received from connection
         * after a BINARY_EVENT packet.
         *
         * @param {Buffer | ArrayBuffer} binData - the raw binary data received
         * @return {null | Object} returns null if more binary data is expected or
         *   a reconstructed packet object if all buffers have been received.
         */
        takeBinaryData(binData) {
            this.buffers.push(binData);
            if (this.buffers.length === this.reconPack.attachments) {
                // done with buffer list
                const packet = binary.reconstructPacket(this.reconPack, this.buffers);
                this.finishedReconstruction();
                return packet;
            }
            return null;
        }
        /**
         * Cleans up binary packet reconstruction variables.
         */
        finishedReconstruction() {
            this.reconPack = null;
            this.buffers = [];
        }
    }
    });

    var on_1 = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.on = void 0;
    function on(obj, ev, fn) {
        obj.on(ev, fn);
        return function subDestroy() {
            obj.off(ev, fn);
        };
    }
    exports.on = on;
    });

    var typedEvents = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.StrictEventEmitter = void 0;

    /**
     * Strictly typed version of an `EventEmitter`. A `TypedEventEmitter` takes type
     * parameters for mappings of event names to event data types, and strictly
     * types method calls to the `EventEmitter` according to these event maps.
     *
     * @typeParam ListenEvents - `EventsMap` of user-defined events that can be
     * listened to with `on` or `once`
     * @typeParam EmitEvents - `EventsMap` of user-defined events that can be
     * emitted with `emit`
     * @typeParam ReservedEvents - `EventsMap` of reserved events, that can be
     * emitted by socket.io with `emitReserved`, and can be listened to with
     * `listen`.
     */
    class StrictEventEmitter extends componentEmitter {
        /**
         * Adds the `listener` function as an event listener for `ev`.
         *
         * @param ev Name of the event
         * @param listener Callback function
         */
        on(ev, listener) {
            super.on(ev, listener);
            return this;
        }
        /**
         * Adds a one-time `listener` function as an event listener for `ev`.
         *
         * @param ev Name of the event
         * @param listener Callback function
         */
        once(ev, listener) {
            super.once(ev, listener);
            return this;
        }
        /**
         * Emits an event.
         *
         * @param ev Name of the event
         * @param args Values to send to listeners of this event
         */
        emit(ev, ...args) {
            super.emit(ev, ...args);
            return this;
        }
        /**
         * Emits a reserved event.
         *
         * This method is `protected`, so that only a class extending
         * `StrictEventEmitter` can emit its own reserved events.
         *
         * @param ev Reserved event name
         * @param args Arguments to emit along with the event
         */
        emitReserved(ev, ...args) {
            super.emit(ev, ...args);
            return this;
        }
        /**
         * Returns the listeners listening to an event.
         *
         * @param event Event name
         * @returns Array of listeners subscribed to `event`
         */
        listeners(event) {
            return super.listeners(event);
        }
    }
    exports.StrictEventEmitter = StrictEventEmitter;
    });

    var socket$1 = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Socket = void 0;



    const debug = browser("socket.io-client:socket");
    /**
     * Internal events.
     * These events can't be emitted by the user.
     */
    const RESERVED_EVENTS = Object.freeze({
        connect: 1,
        connect_error: 1,
        disconnect: 1,
        disconnecting: 1,
        // EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
        newListener: 1,
        removeListener: 1,
    });
    class Socket extends typedEvents.StrictEventEmitter {
        /**
         * `Socket` constructor.
         *
         * @public
         */
        constructor(io, nsp, opts) {
            super();
            this.receiveBuffer = [];
            this.sendBuffer = [];
            this.ids = 0;
            this.acks = {};
            this.flags = {};
            this.io = io;
            this.nsp = nsp;
            this.ids = 0;
            this.acks = {};
            this.receiveBuffer = [];
            this.sendBuffer = [];
            this.connected = false;
            this.disconnected = true;
            this.flags = {};
            if (opts && opts.auth) {
                this.auth = opts.auth;
            }
            if (this.io._autoConnect)
                this.open();
        }
        /**
         * Subscribe to open, close and packet events
         *
         * @private
         */
        subEvents() {
            if (this.subs)
                return;
            const io = this.io;
            this.subs = [
                on_1.on(io, "open", this.onopen.bind(this)),
                on_1.on(io, "packet", this.onpacket.bind(this)),
                on_1.on(io, "error", this.onerror.bind(this)),
                on_1.on(io, "close", this.onclose.bind(this)),
            ];
        }
        /**
         * Whether the Socket will try to reconnect when its Manager connects or reconnects
         */
        get active() {
            return !!this.subs;
        }
        /**
         * "Opens" the socket.
         *
         * @public
         */
        connect() {
            if (this.connected)
                return this;
            this.subEvents();
            if (!this.io["_reconnecting"])
                this.io.open(); // ensure open
            if ("open" === this.io._readyState)
                this.onopen();
            return this;
        }
        /**
         * Alias for connect()
         */
        open() {
            return this.connect();
        }
        /**
         * Sends a `message` event.
         *
         * @return self
         * @public
         */
        send(...args) {
            args.unshift("message");
            this.emit.apply(this, args);
            return this;
        }
        /**
         * Override `emit`.
         * If the event is in `events`, it's emitted normally.
         *
         * @return self
         * @public
         */
        emit(ev, ...args) {
            if (RESERVED_EVENTS.hasOwnProperty(ev)) {
                throw new Error('"' + ev + '" is a reserved event name');
            }
            args.unshift(ev);
            const packet = {
                type: dist.PacketType.EVENT,
                data: args,
            };
            packet.options = {};
            packet.options.compress = this.flags.compress !== false;
            // event ack callback
            if ("function" === typeof args[args.length - 1]) {
                debug("emitting packet with ack id %d", this.ids);
                this.acks[this.ids] = args.pop();
                packet.id = this.ids++;
            }
            const isTransportWritable = this.io.engine &&
                this.io.engine.transport &&
                this.io.engine.transport.writable;
            const discardPacket = this.flags.volatile && (!isTransportWritable || !this.connected);
            if (discardPacket) {
                debug("discard packet as the transport is not currently writable");
            }
            else if (this.connected) {
                this.packet(packet);
            }
            else {
                this.sendBuffer.push(packet);
            }
            this.flags = {};
            return this;
        }
        /**
         * Sends a packet.
         *
         * @param packet
         * @private
         */
        packet(packet) {
            packet.nsp = this.nsp;
            this.io._packet(packet);
        }
        /**
         * Called upon engine `open`.
         *
         * @private
         */
        onopen() {
            debug("transport is open - connecting");
            if (typeof this.auth == "function") {
                this.auth((data) => {
                    this.packet({ type: dist.PacketType.CONNECT, data });
                });
            }
            else {
                this.packet({ type: dist.PacketType.CONNECT, data: this.auth });
            }
        }
        /**
         * Called upon engine or manager `error`.
         *
         * @param err
         * @private
         */
        onerror(err) {
            if (!this.connected) {
                this.emitReserved("connect_error", err);
            }
        }
        /**
         * Called upon engine `close`.
         *
         * @param reason
         * @private
         */
        onclose(reason) {
            debug("close (%s)", reason);
            this.connected = false;
            this.disconnected = true;
            delete this.id;
            this.emitReserved("disconnect", reason);
        }
        /**
         * Called with socket packet.
         *
         * @param packet
         * @private
         */
        onpacket(packet) {
            const sameNamespace = packet.nsp === this.nsp;
            if (!sameNamespace)
                return;
            switch (packet.type) {
                case dist.PacketType.CONNECT:
                    if (packet.data && packet.data.sid) {
                        const id = packet.data.sid;
                        this.onconnect(id);
                    }
                    else {
                        this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
                    }
                    break;
                case dist.PacketType.EVENT:
                    this.onevent(packet);
                    break;
                case dist.PacketType.BINARY_EVENT:
                    this.onevent(packet);
                    break;
                case dist.PacketType.ACK:
                    this.onack(packet);
                    break;
                case dist.PacketType.BINARY_ACK:
                    this.onack(packet);
                    break;
                case dist.PacketType.DISCONNECT:
                    this.ondisconnect();
                    break;
                case dist.PacketType.CONNECT_ERROR:
                    const err = new Error(packet.data.message);
                    // @ts-ignore
                    err.data = packet.data.data;
                    this.emitReserved("connect_error", err);
                    break;
            }
        }
        /**
         * Called upon a server event.
         *
         * @param packet
         * @private
         */
        onevent(packet) {
            const args = packet.data || [];
            debug("emitting event %j", args);
            if (null != packet.id) {
                debug("attaching ack callback to event");
                args.push(this.ack(packet.id));
            }
            if (this.connected) {
                this.emitEvent(args);
            }
            else {
                this.receiveBuffer.push(Object.freeze(args));
            }
        }
        emitEvent(args) {
            if (this._anyListeners && this._anyListeners.length) {
                const listeners = this._anyListeners.slice();
                for (const listener of listeners) {
                    listener.apply(this, args);
                }
            }
            super.emit.apply(this, args);
        }
        /**
         * Produces an ack callback to emit with an event.
         *
         * @private
         */
        ack(id) {
            const self = this;
            let sent = false;
            return function (...args) {
                // prevent double callbacks
                if (sent)
                    return;
                sent = true;
                debug("sending ack %j", args);
                self.packet({
                    type: dist.PacketType.ACK,
                    id: id,
                    data: args,
                });
            };
        }
        /**
         * Called upon a server acknowlegement.
         *
         * @param packet
         * @private
         */
        onack(packet) {
            const ack = this.acks[packet.id];
            if ("function" === typeof ack) {
                debug("calling ack %s with %j", packet.id, packet.data);
                ack.apply(this, packet.data);
                delete this.acks[packet.id];
            }
            else {
                debug("bad ack %s", packet.id);
            }
        }
        /**
         * Called upon server connect.
         *
         * @private
         */
        onconnect(id) {
            debug("socket connected with id %s", id);
            this.id = id;
            this.connected = true;
            this.disconnected = false;
            this.emitBuffered();
            this.emitReserved("connect");
        }
        /**
         * Emit buffered events (received and emitted).
         *
         * @private
         */
        emitBuffered() {
            this.receiveBuffer.forEach((args) => this.emitEvent(args));
            this.receiveBuffer = [];
            this.sendBuffer.forEach((packet) => this.packet(packet));
            this.sendBuffer = [];
        }
        /**
         * Called upon server disconnect.
         *
         * @private
         */
        ondisconnect() {
            debug("server disconnect (%s)", this.nsp);
            this.destroy();
            this.onclose("io server disconnect");
        }
        /**
         * Called upon forced client/server side disconnections,
         * this method ensures the manager stops tracking us and
         * that reconnections don't get triggered for this.
         *
         * @private
         */
        destroy() {
            if (this.subs) {
                // clean subscriptions to avoid reconnections
                this.subs.forEach((subDestroy) => subDestroy());
                this.subs = undefined;
            }
            this.io["_destroy"](this);
        }
        /**
         * Disconnects the socket manually.
         *
         * @return self
         * @public
         */
        disconnect() {
            if (this.connected) {
                debug("performing disconnect (%s)", this.nsp);
                this.packet({ type: dist.PacketType.DISCONNECT });
            }
            // remove socket from pool
            this.destroy();
            if (this.connected) {
                // fire events
                this.onclose("io client disconnect");
            }
            return this;
        }
        /**
         * Alias for disconnect()
         *
         * @return self
         * @public
         */
        close() {
            return this.disconnect();
        }
        /**
         * Sets the compress flag.
         *
         * @param compress - if `true`, compresses the sending data
         * @return self
         * @public
         */
        compress(compress) {
            this.flags.compress = compress;
            return this;
        }
        /**
         * Sets a modifier for a subsequent event emission that the event message will be dropped when this socket is not
         * ready to send messages.
         *
         * @returns self
         * @public
         */
        get volatile() {
            this.flags.volatile = true;
            return this;
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback.
         *
         * @param listener
         * @public
         */
        onAny(listener) {
            this._anyListeners = this._anyListeners || [];
            this._anyListeners.push(listener);
            return this;
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback. The listener is added to the beginning of the listeners array.
         *
         * @param listener
         * @public
         */
        prependAny(listener) {
            this._anyListeners = this._anyListeners || [];
            this._anyListeners.unshift(listener);
            return this;
        }
        /**
         * Removes the listener that will be fired when any event is emitted.
         *
         * @param listener
         * @public
         */
        offAny(listener) {
            if (!this._anyListeners) {
                return this;
            }
            if (listener) {
                const listeners = this._anyListeners;
                for (let i = 0; i < listeners.length; i++) {
                    if (listener === listeners[i]) {
                        listeners.splice(i, 1);
                        return this;
                    }
                }
            }
            else {
                this._anyListeners = [];
            }
            return this;
        }
        /**
         * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
         * e.g. to remove listeners.
         *
         * @public
         */
        listenersAny() {
            return this._anyListeners || [];
        }
    }
    exports.Socket = Socket;
    });

    /**
     * Expose `Backoff`.
     */

    var backo2 = Backoff;

    /**
     * Initialize backoff timer with `opts`.
     *
     * - `min` initial timeout in milliseconds [100]
     * - `max` max timeout [10000]
     * - `jitter` [0]
     * - `factor` [2]
     *
     * @param {Object} opts
     * @api public
     */

    function Backoff(opts) {
      opts = opts || {};
      this.ms = opts.min || 100;
      this.max = opts.max || 10000;
      this.factor = opts.factor || 2;
      this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
      this.attempts = 0;
    }

    /**
     * Return the backoff duration.
     *
     * @return {Number}
     * @api public
     */

    Backoff.prototype.duration = function(){
      var ms = this.ms * Math.pow(this.factor, this.attempts++);
      if (this.jitter) {
        var rand =  Math.random();
        var deviation = Math.floor(rand * this.jitter * ms);
        ms = (Math.floor(rand * 10) & 1) == 0  ? ms - deviation : ms + deviation;
      }
      return Math.min(ms, this.max) | 0;
    };

    /**
     * Reset the number of attempts.
     *
     * @api public
     */

    Backoff.prototype.reset = function(){
      this.attempts = 0;
    };

    /**
     * Set the minimum duration
     *
     * @api public
     */

    Backoff.prototype.setMin = function(min){
      this.ms = min;
    };

    /**
     * Set the maximum duration
     *
     * @api public
     */

    Backoff.prototype.setMax = function(max){
      this.max = max;
    };

    /**
     * Set the jitter
     *
     * @api public
     */

    Backoff.prototype.setJitter = function(jitter){
      this.jitter = jitter;
    };

    var manager = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Manager = void 0;






    const debug = browser("socket.io-client:manager");
    class Manager extends typedEvents.StrictEventEmitter {
        constructor(uri, opts) {
            super();
            this.nsps = {};
            this.subs = [];
            if (uri && "object" === typeof uri) {
                opts = uri;
                uri = undefined;
            }
            opts = opts || {};
            opts.path = opts.path || "/socket.io";
            this.opts = opts;
            this.reconnection(opts.reconnection !== false);
            this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
            this.reconnectionDelay(opts.reconnectionDelay || 1000);
            this.reconnectionDelayMax(opts.reconnectionDelayMax || 5000);
            this.randomizationFactor(opts.randomizationFactor || 0.5);
            this.backoff = new backo2({
                min: this.reconnectionDelay(),
                max: this.reconnectionDelayMax(),
                jitter: this.randomizationFactor(),
            });
            this.timeout(null == opts.timeout ? 20000 : opts.timeout);
            this._readyState = "closed";
            this.uri = uri;
            const _parser = opts.parser || dist;
            this.encoder = new _parser.Encoder();
            this.decoder = new _parser.Decoder();
            this._autoConnect = opts.autoConnect !== false;
            if (this._autoConnect)
                this.open();
        }
        reconnection(v) {
            if (!arguments.length)
                return this._reconnection;
            this._reconnection = !!v;
            return this;
        }
        reconnectionAttempts(v) {
            if (v === undefined)
                return this._reconnectionAttempts;
            this._reconnectionAttempts = v;
            return this;
        }
        reconnectionDelay(v) {
            var _a;
            if (v === undefined)
                return this._reconnectionDelay;
            this._reconnectionDelay = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMin(v);
            return this;
        }
        randomizationFactor(v) {
            var _a;
            if (v === undefined)
                return this._randomizationFactor;
            this._randomizationFactor = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setJitter(v);
            return this;
        }
        reconnectionDelayMax(v) {
            var _a;
            if (v === undefined)
                return this._reconnectionDelayMax;
            this._reconnectionDelayMax = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMax(v);
            return this;
        }
        timeout(v) {
            if (!arguments.length)
                return this._timeout;
            this._timeout = v;
            return this;
        }
        /**
         * Starts trying to reconnect if reconnection is enabled and we have not
         * started reconnecting yet
         *
         * @private
         */
        maybeReconnectOnOpen() {
            // Only try to reconnect if it's the first time we're connecting
            if (!this._reconnecting &&
                this._reconnection &&
                this.backoff.attempts === 0) {
                // keeps reconnection from firing twice for the same reconnection loop
                this.reconnect();
            }
        }
        /**
         * Sets the current transport `socket`.
         *
         * @param {Function} fn - optional, callback
         * @return self
         * @public
         */
        open(fn) {
            debug("readyState %s", this._readyState);
            if (~this._readyState.indexOf("open"))
                return this;
            debug("opening %s", this.uri);
            this.engine = lib(this.uri, this.opts);
            const socket = this.engine;
            const self = this;
            this._readyState = "opening";
            this.skipReconnect = false;
            // emit `open`
            const openSubDestroy = on_1.on(socket, "open", function () {
                self.onopen();
                fn && fn();
            });
            // emit `error`
            const errorSub = on_1.on(socket, "error", (err) => {
                debug("error");
                self.cleanup();
                self._readyState = "closed";
                this.emitReserved("error", err);
                if (fn) {
                    fn(err);
                }
                else {
                    // Only do this if there is no fn to handle the error
                    self.maybeReconnectOnOpen();
                }
            });
            if (false !== this._timeout) {
                const timeout = this._timeout;
                debug("connect attempt will timeout after %d", timeout);
                if (timeout === 0) {
                    openSubDestroy(); // prevents a race condition with the 'open' event
                }
                // set timer
                const timer = setTimeout(() => {
                    debug("connect attempt timed out after %d", timeout);
                    openSubDestroy();
                    socket.close();
                    socket.emit("error", new Error("timeout"));
                }, timeout);
                if (this.opts.autoUnref) {
                    timer.unref();
                }
                this.subs.push(function subDestroy() {
                    clearTimeout(timer);
                });
            }
            this.subs.push(openSubDestroy);
            this.subs.push(errorSub);
            return this;
        }
        /**
         * Alias for open()
         *
         * @return self
         * @public
         */
        connect(fn) {
            return this.open(fn);
        }
        /**
         * Called upon transport open.
         *
         * @private
         */
        onopen() {
            debug("open");
            // clear old subs
            this.cleanup();
            // mark as open
            this._readyState = "open";
            this.emitReserved("open");
            // add new subs
            const socket = this.engine;
            this.subs.push(on_1.on(socket, "ping", this.onping.bind(this)), on_1.on(socket, "data", this.ondata.bind(this)), on_1.on(socket, "error", this.onerror.bind(this)), on_1.on(socket, "close", this.onclose.bind(this)), on_1.on(this.decoder, "decoded", this.ondecoded.bind(this)));
        }
        /**
         * Called upon a ping.
         *
         * @private
         */
        onping() {
            this.emitReserved("ping");
        }
        /**
         * Called with data.
         *
         * @private
         */
        ondata(data) {
            this.decoder.add(data);
        }
        /**
         * Called when parser fully decodes a packet.
         *
         * @private
         */
        ondecoded(packet) {
            this.emitReserved("packet", packet);
        }
        /**
         * Called upon socket error.
         *
         * @private
         */
        onerror(err) {
            debug("error", err);
            this.emitReserved("error", err);
        }
        /**
         * Creates a new socket for the given `nsp`.
         *
         * @return {Socket}
         * @public
         */
        socket(nsp, opts) {
            let socket = this.nsps[nsp];
            if (!socket) {
                socket = new socket$1.Socket(this, nsp, opts);
                this.nsps[nsp] = socket;
            }
            return socket;
        }
        /**
         * Called upon a socket close.
         *
         * @param socket
         * @private
         */
        _destroy(socket) {
            const nsps = Object.keys(this.nsps);
            for (const nsp of nsps) {
                const socket = this.nsps[nsp];
                if (socket.active) {
                    debug("socket %s is still active, skipping close", nsp);
                    return;
                }
            }
            this._close();
        }
        /**
         * Writes a packet.
         *
         * @param packet
         * @private
         */
        _packet(packet) {
            debug("writing packet %j", packet);
            const encodedPackets = this.encoder.encode(packet);
            for (let i = 0; i < encodedPackets.length; i++) {
                this.engine.write(encodedPackets[i], packet.options);
            }
        }
        /**
         * Clean up transport subscriptions and packet buffer.
         *
         * @private
         */
        cleanup() {
            debug("cleanup");
            this.subs.forEach((subDestroy) => subDestroy());
            this.subs.length = 0;
            this.decoder.destroy();
        }
        /**
         * Close the current socket.
         *
         * @private
         */
        _close() {
            debug("disconnect");
            this.skipReconnect = true;
            this._reconnecting = false;
            if ("opening" === this._readyState) {
                // `onclose` will not fire because
                // an open event never happened
                this.cleanup();
            }
            this.backoff.reset();
            this._readyState = "closed";
            if (this.engine)
                this.engine.close();
        }
        /**
         * Alias for close()
         *
         * @private
         */
        disconnect() {
            return this._close();
        }
        /**
         * Called upon engine close.
         *
         * @private
         */
        onclose(reason) {
            debug("onclose");
            this.cleanup();
            this.backoff.reset();
            this._readyState = "closed";
            this.emitReserved("close", reason);
            if (this._reconnection && !this.skipReconnect) {
                this.reconnect();
            }
        }
        /**
         * Attempt a reconnection.
         *
         * @private
         */
        reconnect() {
            if (this._reconnecting || this.skipReconnect)
                return this;
            const self = this;
            if (this.backoff.attempts >= this._reconnectionAttempts) {
                debug("reconnect failed");
                this.backoff.reset();
                this.emitReserved("reconnect_failed");
                this._reconnecting = false;
            }
            else {
                const delay = this.backoff.duration();
                debug("will wait %dms before reconnect attempt", delay);
                this._reconnecting = true;
                const timer = setTimeout(() => {
                    if (self.skipReconnect)
                        return;
                    debug("attempting reconnect");
                    this.emitReserved("reconnect_attempt", self.backoff.attempts);
                    // check again for the case socket closed in above events
                    if (self.skipReconnect)
                        return;
                    self.open((err) => {
                        if (err) {
                            debug("reconnect attempt error");
                            self._reconnecting = false;
                            self.reconnect();
                            this.emitReserved("reconnect_error", err);
                        }
                        else {
                            debug("reconnect success");
                            self.onreconnect();
                        }
                    });
                }, delay);
                if (this.opts.autoUnref) {
                    timer.unref();
                }
                this.subs.push(function subDestroy() {
                    clearTimeout(timer);
                });
            }
        }
        /**
         * Called upon successful reconnect.
         *
         * @private
         */
        onreconnect() {
            const attempt = this.backoff.attempts;
            this._reconnecting = false;
            this.backoff.reset();
            this.emitReserved("reconnect", attempt);
        }
    }
    exports.Manager = Manager;
    });

    var build = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.io = exports.Socket = exports.Manager = exports.protocol = void 0;


    const debug = browser("socket.io-client");
    /**
     * Module exports.
     */
    module.exports = exports = lookup;
    /**
     * Managers cache.
     */
    const cache = (exports.managers = {});
    function lookup(uri, opts) {
        if (typeof uri === "object") {
            opts = uri;
            uri = undefined;
        }
        opts = opts || {};
        const parsed = url_1.url(uri, opts.path || "/socket.io");
        const source = parsed.source;
        const id = parsed.id;
        const path = parsed.path;
        const sameNamespace = cache[id] && path in cache[id]["nsps"];
        const newConnection = opts.forceNew ||
            opts["force new connection"] ||
            false === opts.multiplex ||
            sameNamespace;
        let io;
        if (newConnection) {
            debug("ignoring socket cache for %s", source);
            io = new manager.Manager(source, opts);
        }
        else {
            if (!cache[id]) {
                debug("new io instance for %s", source);
                cache[id] = new manager.Manager(source, opts);
            }
            io = cache[id];
        }
        if (parsed.query && !opts.query) {
            opts.query = parsed.queryKey;
        }
        return io.socket(parsed.path, opts);
    }
    exports.io = lookup;
    /**
     * Protocol version.
     *
     * @public
     */

    Object.defineProperty(exports, "protocol", { enumerable: true, get: function () { return dist.protocol; } });
    /**
     * `connect`.
     *
     * @param {String} uri
     * @public
     */
    exports.connect = lookup;
    /**
     * Expose constructors for standalone build.
     *
     * @public
     */
    var manager_2 = manager;
    Object.defineProperty(exports, "Manager", { enumerable: true, get: function () { return manager_2.Manager; } });

    Object.defineProperty(exports, "Socket", { enumerable: true, get: function () { return socket$1.Socket; } });
    exports.default = lookup;
    });

    var io = /*@__PURE__*/getDefaultExportFromCjs(build);

    io.Manager;
    io.Socket;

    let socket;
    const createPanelConnection = () => {
      socket = io('localhost:6969', {
          withCredentials: true,
        });
      socket.on("connect", () => {
        socket.emit("Control Panel Connected");
        socket.emit('watchGame');
      });
      socket.on('update', (update) => {
        if(update.event === "game:initialized"){
          console.log(update);
          updateScreen();
        }
      });
    };
    const updateScreen = () => {
      let data = {
          data:{
              event:"ctrl_update",
              contents:{
                  seriesLength:document.getElementById("series-length").value,
                  blueScore:document.getElementById("blueWins").value,
                  orngScore:document.getElementById("orngWins").value,
                  orngColor:document.getElementById("orng-color").value,
                  blueColor:document.getElementById("blue-color").value,
                  orngColor2:document.getElementById("orng-color-2").value,
                  blueColor2:document.getElementById("blue-color-2").value,
    	            orngName:document.getElementById("orng-name").value,
    	            blueName:document.getElementById("blue-name").value,
                  orngIcon:document.getElementById("orng-icon").value == "" ? "https://imgur.com/iKhKqw5.png" : document.getElementById("orng-icon").value,
    	            blueIcon:document.getElementById("blue-icon").value == "" ? "https://imgur.com/6cyO4lv.png" : document.getElementById("blue-icon").value,
                  topText:document.getElementById("topbox").value,
              },
          },
      };
      //data = JSON.parse(data);
      console.log(data);
      socket.emit("payload", data);
    };

    /* src\App.svelte generated by Svelte v3.38.3 */

    function create_fragment(ctx) {
    	let main;
    	let button0;
    	let t2;
    	let button1;
    	let t5;
    	let div0;
    	let t7;
    	let div3;
    	let div1;
    	let label0;
    	let t9;
    	let input0;
    	let t10;
    	let datalist;
    	let option0;
    	let option1;
    	let option2;
    	let option3;
    	let t15;
    	let div2;
    	let t18;
    	let br2;
    	let t19;
    	let div4;
    	let t21;
    	let div7;
    	let t27;
    	let br3;
    	let t28;
    	let div8;
    	let t30;
    	let div11;
    	let div9;
    	let label4;
    	let t32;
    	let input4;
    	let t33;
    	let button2;
    	let t35;
    	let div10;
    	let label5;
    	let t37;
    	let input5;
    	let t38;
    	let button3;
    	let t40;
    	let br4;
    	let t41;
    	let button4;
    	let t44;
    	let button5;
    	let t47;
    	let div12;
    	let t49;
    	let div15;
    	let div13;
    	let label6;
    	let t51;
    	let input6;
    	let t52;
    	let input7;
    	let t53;
    	let br7;
    	let t54;
    	let div14;
    	let label7;
    	let t56;
    	let input8;
    	let t57;
    	let input9;
    	let t58;
    	let br8;
    	let t59;
    	let div18;
    	let div16;
    	let label8;
    	let t61;
    	let input10;
    	let t62;
    	let input11;
    	let t63;
    	let div17;
    	let label9;
    	let t65;
    	let input12;
    	let t66;
    	let input13;
    	let t67;
    	let br9;
    	let t68;
    	let div19;
    	let t70;
    	let div20;
    	let t73;
    	let div21;
    	let t76;
    	let br10;
    	let br11;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			main = element("main");
    			button0 = element("button");
    			button0.innerHTML = `Update<br/>Overlay`;
    			t2 = space();
    			button1 = element("button");
    			button1.innerHTML = `Reset<br/>Wins`;
    			t5 = space();
    			div0 = element("div");
    			div0.textContent = "GAME / SERIES INFO";
    			t7 = space();
    			div3 = element("div");
    			div1 = element("div");
    			label0 = element("label");
    			label0.textContent = "Choose a Series Length";
    			t9 = space();
    			input0 = element("input");
    			t10 = space();
    			datalist = element("datalist");
    			option0 = element("option");
    			option0.textContent = "Best of 1";
    			option1 = element("option");
    			option1.textContent = "Best of 3";
    			option2 = element("option");
    			option2.textContent = "Best of 5";
    			option3 = element("option");
    			option3.textContent = "Best of 7";
    			t15 = space();
    			div2 = element("div");

    			div2.innerHTML = `<label for="topbox">Text Above Scoreboard</label> 
			<input type="text" id="topbox"/>`;

    			t18 = space();
    			br2 = element("br");
    			t19 = space();
    			div4 = element("div");
    			div4.textContent = "TEAM NAMES";
    			t21 = space();
    			div7 = element("div");

    			div7.innerHTML = `<div><label for="blue-name" style="color: lightskyblue">Input blue name here</label> 
			<input type="text" id="blue-name" name="blue-name" value=""/></div> 
		<div style="padding-left: 20px"><label for="orng-name" style="color: orange">Input orange name here</label> 
			<input type="text" id="orng-name" name="orng-name" value=""/></div>`;

    			t27 = space();
    			br3 = element("br");
    			t28 = space();
    			div8 = element("div");
    			div8.textContent = "WIN COUNTERS";
    			t30 = space();
    			div11 = element("div");
    			div9 = element("div");
    			label4 = element("label");
    			label4.textContent = "Set wins for Blue (left)";
    			t32 = space();
    			input4 = element("input");
    			t33 = space();
    			button2 = element("button");
    			button2.textContent = "Blue Win";
    			t35 = space();
    			div10 = element("div");
    			label5 = element("label");
    			label5.textContent = "Set wins for Orange (right)";
    			t37 = space();
    			input5 = element("input");
    			t38 = space();
    			button3 = element("button");
    			button3.textContent = "Orange Win";
    			t40 = space();
    			br4 = element("br");
    			t41 = space();
    			button4 = element("button");
    			button4.innerHTML = `Reset<br/>Colors`;
    			t44 = space();
    			button5 = element("button");
    			button5.innerHTML = `Reset<br/>Logos`;
    			t47 = space();
    			div12 = element("div");
    			div12.textContent = "TEAM COLORS";
    			t49 = space();
    			div15 = element("div");
    			div13 = element("div");
    			label6 = element("label");
    			label6.textContent = "Left / Blue Primary";
    			t51 = space();
    			input6 = element("input");
    			t52 = space();
    			input7 = element("input");
    			t53 = space();
    			br7 = element("br");
    			t54 = space();
    			div14 = element("div");
    			label7 = element("label");
    			label7.textContent = "Right / Orange Primary";
    			t56 = space();
    			input8 = element("input");
    			t57 = space();
    			input9 = element("input");
    			t58 = space();
    			br8 = element("br");
    			t59 = space();
    			div18 = element("div");
    			div16 = element("div");
    			label8 = element("label");
    			label8.textContent = "Left / Blue Secondary";
    			t61 = space();
    			input10 = element("input");
    			t62 = space();
    			input11 = element("input");
    			t63 = space();
    			div17 = element("div");
    			label9 = element("label");
    			label9.textContent = "Right / Orange Secondary";
    			t65 = space();
    			input12 = element("input");
    			t66 = space();
    			input13 = element("input");
    			t67 = space();
    			br9 = element("br");
    			t68 = space();
    			div19 = element("div");
    			div19.textContent = "TEAM LOGOS";
    			t70 = space();
    			div20 = element("div");

    			div20.innerHTML = `<label for="blue-icon" style="color: lightskyblue">Input Blue Image Here</label> 
		<input type="url" id="blue-icon" name="blue-icon" style="width: 410px"/>`;

    			t73 = space();
    			div21 = element("div");

    			div21.innerHTML = `<label for="orng-icon" style="color: orange">Input Orange Image Here</label> 
		<input type="url" id="orng-icon" name="orng-icon" style="width: 410px"/>`;

    			t76 = space();
    			br10 = element("br");
    			br11 = element("br");
    			attr(button0, "id", "update-btn");
    			attr(button0, "class", "update-buttons");
    			attr(button1, "id", "reset-wins");
    			attr(button1, "class", "update-buttons");
    			set_style(div0, "color", "lightskyblue");
    			set_style(div0, "font-family", "integral-reg");
    			set_style(div0, "font-size", "24px");
    			attr(label0, "for", "series-length");
    			attr(input0, "list", "series-lengths");
    			attr(input0, "id", "series-length");
    			option0.__value = "Best of 1";
    			option0.value = option0.__value;
    			option1.__value = "Best of 3";
    			option1.value = option1.__value;
    			option2.__value = "Best of 5";
    			option2.value = option2.__value;
    			option3.__value = "Best of 7";
    			option3.value = option3.__value;
    			attr(datalist, "name", "series-length");
    			attr(datalist, "id", "series-lengths");
    			set_style(div2, "padding-left", "20px");
    			set_style(div3, "display", "flex");
    			set_style(div4, "color", "lightskyblue");
    			set_style(div4, "font-family", "integral-reg");
    			set_style(div4, "font-size", "24px");
    			set_style(div7, "display", "flex");
    			set_style(div8, "color", "lightskyblue");
    			set_style(div8, "font-family", "integral-reg");
    			set_style(div8, "font-size", "24px");
    			attr(label4, "for", "blueWins");
    			set_style(label4, "color", "lightskyblue");
    			attr(input4, "type", "number");
    			attr(input4, "id", "blueWins");
    			attr(input4, "name", "blueWins");
    			attr(input4, "min", "0");
    			attr(input4, "max", "4");
    			input4.value = "0";
    			set_style(input4, "width", "90px");
    			attr(button2, "class", "bluebtn");
    			set_style(button2, "width", "100px");
    			attr(label5, "for", "orngWins");
    			set_style(label5, "color", "orange");
    			attr(input5, "type", "number");
    			attr(input5, "id", "orngWins");
    			attr(input5, "name", "orngWins");
    			attr(input5, "min", "0");
    			attr(input5, "max", "4");
    			input5.value = "0";
    			set_style(input5, "width", "93px");
    			attr(button3, "class", "orngbtn");
    			set_style(button3, "width", "100px");
    			set_style(div10, "padding-left", "20px");
    			set_style(div11, "display", "flex");
    			attr(button4, "id", "reset-colors");
    			attr(button4, "class", "update-buttons");
    			attr(button5, "id", "reset-logos");
    			attr(button5, "class", "update-buttons");
    			set_style(div12, "color", "lightskyblue");
    			set_style(div12, "font-family", "integral-reg");
    			set_style(div12, "font-size", "24px");
    			attr(label6, "for", "blue-color");
    			set_style(label6, "color", "lightskyblue");
    			attr(input6, "type", "text");
    			attr(input6, "id", "blue-color");
    			attr(input6, "name", "blue-color");
    			set_style(input6, "width", "140px");
    			input6.value = "#52acfe";
    			attr(input7, "type", "color");
    			attr(input7, "id", "blue-color-picker");
    			attr(input7, "name", "blue-color-picker");
    			input7.value = "#52acfe";
    			attr(label7, "for", "orng-color-2");
    			set_style(label7, "color", "orange");
    			attr(input8, "type", "text");
    			attr(input8, "id", "orng-color-2");
    			attr(input8, "name", "orng-color-2");
    			set_style(input8, "width", "140px");
    			input8.value = "#ee8723";
    			attr(input9, "type", "color");
    			attr(input9, "id", "orng-color-picker-2");
    			attr(input9, "name", "orng-color-picker-2");
    			input9.value = "#ee8723";
    			set_style(div14, "padding-left", "20px");
    			attr(div15, "class", "color-selctors");
    			set_style(div15, "display", "flex");
    			attr(label8, "for", "blue-color-2");
    			set_style(label8, "color", "lightskyblue");
    			attr(input10, "type", "text");
    			attr(input10, "id", "blue-color-2");
    			attr(input10, "name", "blue-color-2");
    			set_style(input10, "width", "140px");
    			input10.value = "#000000";
    			attr(input11, "type", "color");
    			attr(input11, "id", "blue-color-picker-2");
    			attr(input11, "name", "blue-color-picker-2");
    			input11.value = "#000000";
    			attr(label9, "for", "orng-color");
    			set_style(label9, "color", "orange");
    			attr(input12, "type", "text");
    			attr(input12, "id", "orng-color");
    			attr(input12, "name", "orng-color");
    			set_style(input12, "width", "140px");
    			input12.value = "#000000";
    			attr(input13, "type", "color");
    			attr(input13, "id", "orng-color-picker");
    			attr(input13, "name", "orng-color-picker");
    			input13.value = "#000000";
    			set_style(div17, "padding-left", "20px");
    			attr(div18, "class", "color-selectors");
    			set_style(div18, "display", "flex");
    			set_style(div19, "color", "lightskyblue");
    			set_style(div19, "font-family", "integral-reg");
    			set_style(div19, "font-size", "24px");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, button0);
    			append(main, t2);
    			append(main, button1);
    			append(main, t5);
    			append(main, div0);
    			append(main, t7);
    			append(main, div3);
    			append(div3, div1);
    			append(div1, label0);
    			append(div1, t9);
    			append(div1, input0);
    			append(div1, t10);
    			append(div1, datalist);
    			append(datalist, option0);
    			append(datalist, option1);
    			append(datalist, option2);
    			append(datalist, option3);
    			append(div3, t15);
    			append(div3, div2);
    			append(main, t18);
    			append(main, br2);
    			append(main, t19);
    			append(main, div4);
    			append(main, t21);
    			append(main, div7);
    			append(main, t27);
    			append(main, br3);
    			append(main, t28);
    			append(main, div8);
    			append(main, t30);
    			append(main, div11);
    			append(div11, div9);
    			append(div9, label4);
    			append(div9, t32);
    			append(div9, input4);
    			append(div9, t33);
    			append(div9, button2);
    			append(div11, t35);
    			append(div11, div10);
    			append(div10, label5);
    			append(div10, t37);
    			append(div10, input5);
    			append(div10, t38);
    			append(div10, button3);
    			append(main, t40);
    			append(main, br4);
    			append(main, t41);
    			append(main, button4);
    			append(main, t44);
    			append(main, button5);
    			append(main, t47);
    			append(main, div12);
    			append(main, t49);
    			append(main, div15);
    			append(div15, div13);
    			append(div13, label6);
    			append(div13, t51);
    			append(div13, input6);
    			append(div13, t52);
    			append(div13, input7);
    			append(div15, t53);
    			append(div15, br7);
    			append(div15, t54);
    			append(div15, div14);
    			append(div14, label7);
    			append(div14, t56);
    			append(div14, input8);
    			append(div14, t57);
    			append(div14, input9);
    			append(main, t58);
    			append(main, br8);
    			append(main, t59);
    			append(main, div18);
    			append(div18, div16);
    			append(div16, label8);
    			append(div16, t61);
    			append(div16, input10);
    			append(div16, t62);
    			append(div16, input11);
    			append(div18, t63);
    			append(div18, div17);
    			append(div17, label9);
    			append(div17, t65);
    			append(div17, input12);
    			append(div17, t66);
    			append(div17, input13);
    			append(main, t67);
    			append(main, br9);
    			append(main, t68);
    			append(main, div19);
    			append(main, t70);
    			append(main, div20);
    			append(main, t73);
    			append(main, div21);
    			append(main, t76);
    			append(main, br10);
    			append(main, br11);

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*click_handler*/ ctx[0]),
    					listen(button1, "click", /*click_handler_1*/ ctx[1]),
    					listen(button2, "click", /*click_handler_2*/ ctx[2]),
    					listen(button3, "click", /*click_handler_3*/ ctx[3]),
    					listen(button4, "click", /*click_handler_4*/ ctx[4]),
    					listen(button5, "click", /*click_handler_5*/ ctx[5]),
    					listen(input6, "keyup", /*keyup_handler*/ ctx[6]),
    					listen(input7, "change", /*change_handler*/ ctx[7]),
    					listen(input8, "keyup", /*keyup_handler_1*/ ctx[8]),
    					listen(input9, "change", /*change_handler_1*/ ctx[9]),
    					listen(input10, "keyup", /*keyup_handler_2*/ ctx[10]),
    					listen(input11, "change", /*change_handler_2*/ ctx[11]),
    					listen(input12, "keyup", /*keyup_handler_3*/ ctx[12]),
    					listen(input13, "change", /*change_handler_3*/ ctx[13])
    				];

    				mounted = true;
    			}
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(main);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function blueUp() {
    	if (document.getElementById("blueWins").value != 4) {
    		document.getElementById("blueWins").value = parseInt(document.getElementById("blueWins").value) + 1;
    	}
    }

    function orngUp() {
    	if (document.getElementById("orngWins").value != 4) {
    		document.getElementById("orngWins").value = parseInt(document.getElementById("orngWins").value) + 1;
    	}
    }

    function resetWins() {
    	document.getElementById("orngWins").value = 0;
    	document.getElementById("blueWins").value = 0;
    }

    function resetLogos() {
    	document.getElementById("orng-icon").value = "";
    	document.getElementById("blue-icon").value = "";
    }

    function resetColors() {
    	document.getElementById("orng-color").value = "#000000";
    	document.getElementById("orng-color-2").value = "#ee8723";
    	document.getElementById("blue-color").value = "#52acfe";
    	document.getElementById("blue-color-2").value = "#000000";
    	document.getElementById("orng-color-picker").value = "#000000";
    	document.getElementById("orng-color-picker-2").value = "#ee8723";
    	document.getElementById("blue-color-picker").value = "#52acfe";
    	document.getElementById("blue-color-picker-2").value = "#000000";
    }

    function bluecolor() {
    	document.getElementById("blue-color-picker").value = document.getElementById("blue-color").value;
    }

    function orangecolor() {
    	document.getElementById("orng-color-picker").value = document.getElementById("orng-color").value;
    }

    function bluecolortobox() {
    	document.getElementById("blue-color").value = document.getElementById("blue-color-picker").value;
    }

    function orangecolortobox() {
    	document.getElementById("orng-color").value = document.getElementById("orng-color-picker").value;
    }

    function bluecolor2() {
    	document.getElementById("blue-color-picker-2").value = document.getElementById("blue-color-2").value;
    }

    function orangecolor2() {
    	document.getElementById("orng-color-picker-2").value = document.getElementById("orng-color-2").value;
    }

    function bluecolortobox2() {
    	document.getElementById("blue-color-2").value = document.getElementById("blue-color-picker-2").value;
    }

    function orangecolortobox2() {
    	document.getElementById("orng-color-2").value = document.getElementById("orng-color-picker-2").value;
    }

    function instance($$self) {
    	onMount(() => {
    		createPanelConnection();
    	});

    	const click_handler = () => updateScreen();
    	const click_handler_1 = () => resetWins();
    	const click_handler_2 = () => blueUp();
    	const click_handler_3 = () => orngUp();
    	const click_handler_4 = () => resetColors();
    	const click_handler_5 = () => resetLogos();
    	const keyup_handler = () => bluecolor();
    	const change_handler = () => bluecolortobox();
    	const keyup_handler_1 = () => orangecolor2();
    	const change_handler_1 = () => orangecolortobox2();
    	const keyup_handler_2 = () => bluecolor2();
    	const change_handler_2 = () => bluecolortobox2();
    	const keyup_handler_3 = () => orangecolor();
    	const change_handler_3 = () => orangecolortobox();

    	return [
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		click_handler_3,
    		click_handler_4,
    		click_handler_5,
    		keyup_handler,
    		change_handler,
    		keyup_handler_1,
    		change_handler_1,
    		keyup_handler_2,
    		change_handler_2,
    		keyup_handler_3,
    		change_handler_3
    	];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body,
    	props: {
    	}
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
