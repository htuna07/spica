import {Injectable} from "@nestjs/common";
import {ChangeStream, DatabaseService, Document} from "@spica-server/database";
import {Observable} from "rxjs";
import {FindOptions, StreamChunk} from "./interface";
import {Emitter} from "./stream";
const isEqual = require("lodash/isEqual");

@Injectable()
export class RealtimeDatabaseService {
  constructor(private database: DatabaseService) {}

  private changeStreams = new Map<string, ChangeStream>();
  private getChangeStream(name: string) {
    if (this.changeStreams.has(name)) {
      return this.changeStreams.get(name);
    }

    const changeStream = this.database.collection(name).watch([], {fullDocument: "updateLookup"});
    this.changeStreams.set(name, changeStream);

    return changeStream;
  }

  private emitters = new Map<string, {value: Emitter<any>; listenerCount: number}>();
  private getEmitter(name: string, options: FindOptions<any>) {
    let emitterName = this.findEmitterName(name, options);

    if (emitterName) {
      const emitter = this.emitters.get(emitterName);
      emitter.listenerCount++;
      return emitter.value;
    }

    const changeStream = this.getChangeStream(name);
    const emitter = {
      value: new Emitter(this.database.collection(name), changeStream, options),
      listenerCount: 1
    };

    emitterName = this.getUniqueEmitterName(name, options);
    this.emitters.set(emitterName, emitter);

    return emitter.value;
  }

  private findEmitterName(name: string, options: FindOptions<any>) {
    for (const key of this.emitters.keys()) {
      const emitterFilter = key.includes(name) ? JSON.parse(key.replace(name + "_", "")) : false;
      if (emitterFilter && isEqual(emitterFilter, options)) {
        return key;
      }
    }

    return undefined;
  }

  doesEmitterExist(name: string, options: FindOptions<any>) {
    return !!this.findEmitterName(name, options);
  }

  removeEmitter(name: string, options: FindOptions<any>) {
    const emitterName = this.findEmitterName(name, options);

    const emitter = this.emitters.get(emitterName);

    emitter.listenerCount--;

    if (emitter.listenerCount == 0) {
      this.emitters.delete(emitterName);
      const collName = emitter.value.collectionName;

      const streamListenersRemain = Array.from(this.emitters.values())
        .map(v => v.value.collectionName)
        .some(name => name == collName);

      if (!streamListenersRemain) {
        const changeStream = this.changeStreams.get(collName);
        changeStream.close();
        changeStream.removeAllListeners(); // ??

        this.changeStreams.delete(collName);
      }
    }
  }

  getUniqueEmitterName(name: string, options: FindOptions<any>) {
    // put here better comparison since string comparison might be mistaken if they were converted from object
    // for example => '{name:"1",desc:"2"}' == '{desc:"2",name:"1"}' these are same filters but string comparsion will say opposite
    return `${name}_${JSON.stringify(options)}`;
  }

  find<T extends Document = any>(
    name: string,
    options: FindOptions<T> = {}
  ): Observable<StreamChunk<T>> {
    return this.getEmitter(name, options).getObservable();
  }
}
