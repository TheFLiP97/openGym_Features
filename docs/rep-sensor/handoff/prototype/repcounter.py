"""Kausaler Rep-Zähler: arbeitet Sample für Sample, nur Rohbeschleunigung MIT Gravitation.
Gleiche Eingabe wie Browser (accelerationIncludingGravity) oder eigener IMU-Sensor."""
import math

class RepCounter:
    def __init__(self, fs, p=None):
        self.p = dict(rest_s=1.0, fc=4.0, thr_bot=1.2, thr_top=1.2, release=0.3, refr_s=0.8)
        if p: self.p.update(p)
        self.fs=fs; self.n_rest=int(self.p['rest_s']*fs)
        self.alpha=1-math.exp(-2*math.pi*self.p['fc']/fs)
        self.sum=[0,0,0]; self.k=0; self.u=None; self.g=0
        self.y=0; self.state='wait_bottom'; self.last=-1e9; self.reps=0

    def step(self, t, ax, ay, az):           # Einheit egal (m/s² oder g), wird per g normiert
        if self.k < self.n_rest:                # 1) Ruhephase: Gravitationsvektor schätzen
            self.sum=[s+v for s,v in zip(self.sum,(ax,ay,az))]; self.k+=1
            if self.k==self.n_rest:
                m=[s/self.n_rest for s in self.sum]; self.g=math.sqrt(sum(v*v for v in m))
                self.u=[v/self.g for v in m]
            return None
        s=(ax*self.u[0]+ay*self.u[1]+az*self.u[2]-self.g)/self.g*9.81   # 2) vertikal, m/s², + = hoch
        self.y+=self.alpha*(s-self.y)                                   # 3) Tiefpass 1. Ordnung
        p=self.p                                                        # 4) Zustandsautomat
        if self.state=='wait_bottom' and self.y>p['thr_bot']: self.state='wait_top'
        elif self.state=='wait_top' and self.y<-p['thr_top']: self.state='in_top'
        elif self.state=='in_top' and self.y>-p['release'] and t-self.last>p['refr_s']:
            self.reps+=1; self.last=t; self.state='wait_bottom'; return self.reps
        return None

if __name__=='__main__':
    import sys, csv
    rows=list(csv.DictReader(open(sys.argv[1])))
    for fs in (100,60,30):
        step=round(100/fs); rc=RepCounter(100/step); ev=[]
        for r in rows[::step]:
            n=rc.step(float(r['seconds_elapsed']),float(r['x']),float(r['y']),float(r['z']))
            if n: ev.append(round(float(r['seconds_elapsed']),2))
        print(f"{fs:3d} Hz: {len(ev)} Reps, gezählt bei t = {ev}")
