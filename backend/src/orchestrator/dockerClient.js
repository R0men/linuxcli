import Docker from 'dockerode';
import { config } from '../config.js';

let docker;

export function getDocker() {
  if (!docker) {
    docker = new Docker({ socketPath: config.dockerSocket });
  }
  return docker;
}
