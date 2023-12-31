// @ts-check

const { Command: CommandBase } = require('commander');
const { Option } = require('./option.js');
const { Argument } = require('./argument.js');
const { isThenable, callOrChain } = require('./utils.js');

/**
 * @typedef {import('../typings/commander').OptionValueSource} OptionValueSource
 * @typedef {import('../typings/commander').ParseOptions} ParseOptions
 * @typedef {import('../typings/utils').RawOptionValueSource} RawOptionValueSource
 */

class Command extends CommandBase {
  /** @type {readonly Command[]} */
  commands = [];
  /** @type {readonly Option[]} */
  options = [];
  /** @type {readonly Argument[]} */
  _args = [];

  /**
   * @type {{ [key: string]: string }}
   * @package
   */
  __recommander_rawOptionValues = {};
  /**
   * @type {{ [key: string]: RawOptionValueSource }}
   * @package
   */
  __recommander_rawOptionValueSources = {};
  /**
   * @type {boolean}
   * @package
   */
  __recommander_asyncParsing = false;
  /**
   * @type {boolean}
   */
  #awaited = false;
  /**
   * @type {Command | null}
   * @package
   */
  __recommander_dispatchedSubcommand = null;

  constructor() {
    super(...arguments);

    /**
     * @param {CommandBase} thisCommand
     * @param {CommandBase} subcommand
     */
    const preSubcommandHook = (thisCommand, subcommand) => {
      this.__recommander_dispatchedSubcommand =
        /** @type {Command} */ (subcommand);
      this.__recommander_dispatchedSubcommand
        .__recommander_newParseState(this.__recommander_asyncParsing);
      return this.__recommander_await();
    };
    this.hook('preSubcommand', preSubcommandHook);

    /**
     * @param {CommandBase} thisCommand
     * @param {CommandBase} actionCommand
     */
    const preActionHook = (thisCommand, actionCommand) => {
      if (thisCommand === actionCommand) {
        return this.__recommander_await();
      }
    };
    this.hook('preAction', preActionHook);
  }

  /**
   * @override
   * @param {string} [name]
   * @returns {Command}
   */
  createCommand(name) {
    return new Command(name);
  }

  /**
   * @override
   * @param {string} flags
   * @param {string} [description]
   * @returns {Option}
   */
  createOption(flags, description) {
    return new Option(flags, description);
  }

  /**
   * @override
   * @param {string} name
   * @param {string} [description]
   * @returns {Argument}
   */
  createArgument(name, description) {
    return new Argument(name, description);
  }

  /**
   * @override
   * @param {Option} option
   * @returns {this}
   */
  addOption(option) {
    const oname = option.name();
    const name = option.attributeName();
    /**
     * @param {RawOptionValueSource} source
     * @returns {(value: string) => void}
     */
    const makeListener = source => value => {
      this.__recommander_rawOptionValues[name] = value;
      this.__recommander_rawOptionValueSources[name] = source;
    };
    this.on(`option:${oname}`, makeListener('cli'));
    if (option.envVar) {
      this.on(`optionEnv:${oname}`, makeListener('env'));
    }
    super.addOption(option);
    return this;
  }

  /**
   * @param {boolean} async
   * @package
   */
  __recommander_newParseState(async) {
    this.__recommander_asyncParsing = async;
    this.#awaited = false;
  }

  /**
   * @overload
   * @param {false} async
   * @param {() => this} callback
   * @returns {this}
   */
  /**
   * @overload
   * @param {true} async
   * @param {() => Promise<this>} callback
   * @returns {Promise<this>}
   */
  /**
   * @param {boolean} async
   * @param {(() => this) | (() => Promise<this>)} callback
   * @returns {this | Promise<this>}
   */
  #parseSubroutine(async, callback) {
    this.__recommander_newParseState(async);
    [...this.options, ...this._args].forEach(target => {
      target.__recommander_command = this;
    });
    let result = callback();
    result = callOrChain(result, () => {
      let leafCommand;
      for (
        leafCommand = this;
        leafCommand.__recommander_dispatchedSubcommand;
        leafCommand = leafCommand.__recommander_dispatchedSubcommand
      );
      leafCommand.__recommander_await(); // in case it has no action handler
    });
    result = callOrChain(result, () => this);
    return result;
  }

  /**
   * @override
   * @param {readonly string[]} [argv]
   * @param {ParseOptions} [options]
   * @returns {this}
   */
  parse(argv, options) {
    return this.#parseSubroutine(false, () => super.parse(argv, options));
  }

  /**
   * @override
   * @param {readonly string[]} [argv]
   * @param {ParseOptions} [options]
   * @returns {Promise<this>}
   */
  parseAsync(argv, options) {
    return this.#parseSubroutine(true, () => super.parseAsync(argv, options));
  }

  /**
   * @template T
   * @param {() => Promise<T>[]} getPromises
   */
  #conditionalAwait(getPromises) {
    if (this.__recommander_asyncParsing && !this.#awaited) {
      this.#awaited = true;
      const toAwait = getPromises();
      if (toAwait.length) return Promise.all(toAwait);
    }
  }

  /**
   * @package
   */
  __recommander_await = () => {
    return /** @type {Promise<never>} */ (this.#conditionalAwait(() => {
      const optionPromises = /** @type {[string, PromiseLike<unknown>][]} */ (
        Object.entries(this.opts()).filter(([_, value]) => isThenable(value))
      ).map(([key, thenable]) => (async() => {
        this.setOptionValueWithSource(
          key,
          await thenable,
          /** @type {OptionValueSource} */ (this.getOptionValueSource(key)),
        );
      })());

      const argumentPromises = this.processedArgs
        .filter(isThenable)
        .map((thenable, i) => (async() => {
          this.processedArgs[i] = await thenable;
        })());

      return [
        ...optionPromises,
        ...argumentPromises,
      ];
    }));
  };
}

exports.Command = Command;
