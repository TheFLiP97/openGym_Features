import sys, pandas as pd, numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from scipy.signal import find_peaks
d=sys.argv[1]
a=pd.read_csv(f"{d}/Accelerometer.csv"); g=pd.read_csv(f"{d}/Gravity.csv"); w=pd.read_csv(f"{d}/Gyroscope.csv")
t=a.seconds_elapsed.values; A=a[['x','y','z']].values; G=g[['x','y','z']].values
up=(A*G/np.linalg.norm(G,axis=1)[:,None]).sum(1)
pk,_=find_peaks(-up,height=1.8,distance=150); pk=pk[t[pk]<26]
fig,ax=plt.subplots(2,1,figsize=(13,6.5),sharex=True,gridspec_kw={'height_ratios':[3,1]})
ax[0].plot(t,up,lw=.9,c='#2563eb'); ax[0].axhline(0,c='k',lw=.4)
for i,p in enumerate(pk): ax[0].annotate(str(i+1),(t[p],up[p]-0.5),ha='center',fontsize=10,color='#dc2626')
ax[0].axvspan(0,1.8,color='#16a34a',alpha=.1); ax[0].text(0.1,3.5,"Ruhe",color='#16a34a')
ax[0].axvspan(24,28,color='#f59e0b',alpha=.12); ax[0].text(24.2,3.5,"Absetzen/Handling",color='#b45309')
ax[0].set_ylabel("Vertikalbeschl. [m/s², + = hoch]"); ax[0].set_title("Leg Extension 55 kg – 10 Reps, 100 Hz (Nummern = oberer Umkehrpunkt)")
ax[1].plot(t,w[['x','y','z']].values,lw=.7); ax[1].set_ylabel("Gyro [rad/s]"); ax[1].set_xlabel("Zeit [s]")
plt.tight_layout(); plt.savefig(sys.argv[2],dpi=110)
print(len(pk))
